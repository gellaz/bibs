import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db";
import { paymentMethod } from "@/db/schemas/payment-method";
import { sellerProfile } from "@/db/schemas/seller";
import {
	accountStateFromV2,
	type ConnectStatus,
	connectStatus,
} from "@/lib/connect-status";
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
 * Trade-off accettato: se la transazione fallisce dopo una v2 accounts.create
 * riuscita, resta un conto Express mai onboardato orfano su Stripe (taggato
 * `metadata.sellerProfileId`, nessuna fee finché non viene attivato). Non
 * usiamo un'idempotency key fissa per evitarlo: replicherebbe per 24h anche
 * una v2 accounts.create fallita per un motivo reale (es. email invalida),
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

		// Accounts v2 (Stripe rifiuta v1 per le nuove piattaforme). Solo la
		// configurazione `recipient`: con separate charges & transfers (PR F) bibs
		// è merchant of record e al conto serve soltanto ricevere i trasferimenti
		// (`stripe_balance.stripe_transfers`, che richiede da sé anche i payouts).
		// Dashboard Express, fee e perdite a carico della piattaforma: losses
		// `application` richiede la loss-liability acknowledgement nel Platform
		// profile di Stripe.
		let account: Stripe.Response<Stripe.V2.Core.Account>;
		try {
			account = await stripe.v2.core.accounts.create({
				contact_email: email,
				dashboard: "express",
				identity: { country: "IT" },
				defaults: {
					responsibilities: {
						fees_collector: "application",
						losses_collector: "application",
					},
				},
				configuration: {
					recipient: {
						capabilities: {
							stripe_balance: { stripe_transfers: { requested: true } },
						},
					},
				},
				metadata: { sellerProfileId },
				include: ["configuration.recipient", "requirements"],
			});
		} catch (err) {
			if (err instanceof Stripe.errors.StripeError) {
				logger.error(
					{ sellerProfileId, err },
					"stripe.v2.core.accounts.create failed",
				);
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
		const link = await stripe.v2.core.accountLinks.create({
			account,
			use_case: {
				type: "account_onboarding",
				account_onboarding: {
					configurations: ["recipient"],
					refresh_url: `${env.SELLER_APP_URL}/payments/refresh`,
					return_url: `${env.SELLER_APP_URL}/payments/return`,
				},
			},
		});
		return { url: link.url };
	} catch (err) {
		if (err instanceof Stripe.errors.StripeError) {
			logger.error(
				{ sellerProfileId: params.sellerProfileId, err },
				"stripe.v2.core.accountLinks.create failed",
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
 * `account_invalid`, o un 404 generico come lo restituisce l'API v2) o la
 * piattaforma ha perso i permessi su di esso (`StripePermissionError`).
 * Distinto da errori transitori (rete, 5xx Stripe) che devono continuare a
 * rifar fallire il webhook per il retry di Stripe.
 */
function isPermanentlyInaccessible(err: unknown): boolean {
	if (!(err instanceof Stripe.errors.StripeError)) return false;
	if (err instanceof Stripe.errors.StripePermissionError) return true;
	return (
		err.code === "resource_missing" ||
		err.code === "account_invalid" ||
		err.statusCode === 404
	);
}

/**
 * Rilegge il conto da Stripe (Accounts v2) e ne copia lo stato. Usata dal
 * webhook account.updated e dal sync al ritorno dall'onboarding: rileggere
 * invece di fidarsi dello snapshot dell'evento rende innocui gli eventi fuori
 * ordine.
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

	let account: Stripe.Response<Stripe.V2.Core.Account>;
	try {
		account = await stripe.v2.core.accounts.retrieve(stripeAccountId, {
			include: ["configuration.recipient", "requirements"],
		});
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
		.set(accountStateFromV2(account))
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
