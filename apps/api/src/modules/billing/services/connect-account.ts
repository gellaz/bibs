import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { paymentMethod } from "@/db/schemas/payment-method";
import { sellerProfile } from "@/db/schemas/seller";
import { type ConnectStatus, connectStatus } from "@/lib/connect-status";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
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
 * payment_methods dopo il primo e trova il conto. L'idempotency key copre il
 * caso in cui la tx fallisca dopo accounts.create (retry → stesso conto).
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
		const account = await stripe.accounts.create(
			{
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
			},
			{ idempotencyKey: `connect-account:${sellerProfileId}` },
		);

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
	const link = await stripe.accountLinks.create({
		account,
		type: "account_onboarding",
		return_url: `${env.SELLER_APP_URL}/payments/return`,
		refresh_url: `${env.SELLER_APP_URL}/payments/refresh`,
	});
	return { url: link.url };
}

/**
 * Rilegge il conto da Stripe e ne copia lo stato. Usata dal webhook
 * account.updated e dal sync al ritorno dall'onboarding: rileggere invece di
 * fidarsi dello snapshot dell'evento rende innocui gli eventi fuori ordine.
 */
export async function refreshConnectAccount(
	stripeAccountId: string,
): Promise<PaymentMethodRow | null> {
	const known = await db.query.paymentMethod.findFirst({
		where: eq(paymentMethod.stripeAccountId, stripeAccountId),
	});
	if (!known) return null;

	const account = await stripe.accounts.retrieve(stripeAccountId);
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
