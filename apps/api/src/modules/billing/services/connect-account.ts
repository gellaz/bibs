import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db";
import { paymentMethod } from "@/db/schemas/payment-method";
import { sellerProfile } from "@/db/schemas/seller";
import { type ConnectStatus, connectStatus } from "@/lib/connect-status";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PaymentMethodRow = typeof paymentMethod.$inferSelect;

export interface OnlinePayments {
	status: ConnectStatus;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
}

/** Proietta la riga payment_methods nella forma che vede il seller. */
export function toOnlinePayments(
	pm: PaymentMethodRow | null | undefined,
): OnlinePayments {
	return {
		status: connectStatus(pm),
		chargesEnabled: pm?.chargesEnabled ?? false,
		payoutsEnabled: pm?.payoutsEnabled ?? false,
	};
}

export function getDefaultPaymentMethod(
	sellerProfileId: string,
	tx: Tx | typeof db = db,
) {
	return tx.query.paymentMethod.findFirst({
		where: and(
			eq(paymentMethod.sellerProfileId, sellerProfileId),
			eq(paymentMethod.isDefault, true),
		),
	});
}

/**
 * Il conto Connect del seller, creato alla prima richiesta. Il lock sulla riga
 * seller_profiles serializza due click ravvicinati: il secondo rilegge
 * payment_methods dopo il primo e trova il conto creato dal primo.
 *
 * Trade-off accettato: se la transazione fallisce dopo una accounts.create
 * riuscita, resta un conto Express mai onboardato orfano su Stripe (taggato
 * `metadata.sellerProfileId`, nessuna fee finché non viene attivato). Non
 * usiamo un'idempotency key fissa per evitarlo: replicherebbe per 24h anche
 * una accounts.create fallita per un motivo reale (es. email invalida),
 * bloccando ogni retry dell'utente con lo stesso errore.
 */
async function ensureConnectAccount(
	sellerProfileId: string,
	email: string,
): Promise<string> {
	return db.transaction(async (tx) => {
		await tx
			.select({ id: sellerProfile.id })
			.from(sellerProfile)
			.where(eq(sellerProfile.id, sellerProfileId))
			.for("update");

		const existing = await getDefaultPaymentMethod(sellerProfileId, tx);
		if (existing?.stripeAccountId) return existing.stripeAccountId;

		// Controller properties equivalenti a un conto Express (Stripe marca
		// `type` come legacy). card_payments + transfers: charges_enabled
		// significa "può incassare", e la PR F trasferisce con separate charges.
		let account: Stripe.Response<Stripe.Account>;
		try {
			account = await stripe.accounts.create({
				country: "IT",
				email,
				controller: {
					stripe_dashboard: { type: "express" },
					fees: { payer: "application" },
					losses: { payments: "application" },
					requirement_collection: "stripe",
				},
				capabilities: {
					card_payments: { requested: true },
					transfers: { requested: true },
				},
				metadata: { sellerProfileId },
			});
		} catch (err) {
			if (err instanceof Stripe.errors.StripeError) {
				logger.error({ sellerProfileId, err }, "stripe.accounts.create failed");
				throw new ServiceError(
					502,
					"Non è stato possibile attivare i pagamenti online. Riprova tra qualche minuto.",
				);
			}
			throw err;
		}

		if (existing) {
			await tx
				.update(paymentMethod)
				.set({ stripeAccountId: account.id })
				.where(eq(paymentMethod.id, existing.id));
		} else {
			await tx
				.insert(paymentMethod)
				.values({ sellerProfileId, stripeAccountId: account.id });
		}
		return account.id;
	});
}

/** Link all'onboarding ospitato da Stripe; scade in pochi minuti, va usato subito. */
export async function createOnboardingLink(params: {
	sellerProfileId: string;
	email: string;
}): Promise<{ url: string }> {
	const account = await ensureConnectAccount(
		params.sellerProfileId,
		params.email,
	);
	try {
		const link = await stripe.accountLinks.create({
			account,
			type: "account_onboarding",
			return_url: `${env.SELLER_APP_URL}/payments/return`,
			refresh_url: `${env.SELLER_APP_URL}/payments/refresh`,
		});
		return { url: link.url };
	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			logger.error(
				{ sellerProfileId: params.sellerProfileId, err },
				"stripe.accountLinks.create failed",
			);
			throw new ServiceError(
				502,
				"Non è stato possibile attivare i pagamenti online. Riprova tra qualche minuto.",
			);
		}
		throw err;
	}
}

/**
 * True per gli errori Stripe che non si risolveranno mai da soli su un
 * retry: il conto è stato disconnesso/cancellato (`resource_missing`,
 * `account_invalid`) o la piattaforma ha perso i permessi su di esso
 * (`StripePermissionError`). Distinto da errori transitori (rete, 5xx Stripe)
 * che devono continuare a rifar fallire il webhook per il retry di Stripe.
 */
function isPermanentlyInaccessible(err: unknown): boolean {
	if (!(err instanceof Stripe.errors.StripeError)) return false;
	if (err instanceof Stripe.errors.StripePermissionError) return true;
	return err.code === "resource_missing" || err.code === "account_invalid";
}

/**
 * Rilegge il conto da Stripe e ne copia lo stato. Usata dal webhook
 * account.updated e dal sync al ritorno dall'onboarding: rileggere invece di
 * fidarsi dello snapshot dell'evento rende innocui gli eventi fuori ordine.
 *
 * Un conto permanentemente irraggiungibile (cancellato lato Stripe, permessi
 * revocati) non deve far fallire il webhook per giorni: viene invece
 * degradato a "nessun incasso" localmente. Altri errori (rete, 5xx Stripe)
 * risalgono invariati così che il chiamante (webhook → 500) faccia ritentare
 * Stripe.
 */
export async function refreshConnectAccount(
	stripeAccountId: string,
): Promise<PaymentMethodRow | null> {
	const known = await db.query.paymentMethod.findFirst({
		where: eq(paymentMethod.stripeAccountId, stripeAccountId),
	});
	if (!known) return null;

	let account: Stripe.Response<Stripe.Account>;
	try {
		account = await stripe.accounts.retrieve(stripeAccountId);
	} catch (err) {
		if (!isPermanentlyInaccessible(err)) throw err;
		logger.warn(
			{ stripeAccountId, err },
			"Stripe Connect account permanently inaccessible, flagging as disabled",
		);
		const [row] = await db
			.update(paymentMethod)
			.set({
				chargesEnabled: false,
				payoutsEnabled: false,
				detailsSubmitted: false,
			})
			.where(eq(paymentMethod.id, known.id))
			.returning();
		return row;
	}

	const [row] = await db
		.update(paymentMethod)
		.set({
			chargesEnabled: account.charges_enabled,
			payoutsEnabled: account.payouts_enabled,
			detailsSubmitted: account.details_submitted,
		})
		.where(eq(paymentMethod.id, known.id))
		.returning();
	return row;
}

/**
 * Chiamata dal FE al ritorno dall'onboarding: rilegge il conto da Stripe
 * (mai fidarsi del return_url) e restituisce lo stato aggiornato.
 */
export async function syncOnlinePayments(
	sellerProfileId: string,
): Promise<OnlinePayments> {
	const pm = await getDefaultPaymentMethod(sellerProfileId);
	if (!pm?.stripeAccountId)
		throw new ServiceError(404, "Pagamenti online non ancora attivati");
	return toOnlinePayments(await refreshConnectAccount(pm.stripeAccountId));
}
