import {
	type RenderedEmail,
	renderPaymentFailedEmail,
	renderStoreCanceledEmail,
	renderStoreSuspendedEmail,
} from "@bibs/emails";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Email di billing al titolare del negozio (mai ai dipendenti: il destinatario
 * è l'utente del seller_profile che possiede il negozio).
 *
 * Si chiamano DOPO la scrittura sul DB e non lanciano mai: un'email che non
 * parte non deve far fallire il webhook, altrimenti Stripe lo riconsegnerebbe
 * e la transizione di stato — già scritta — non si ripeterebbe comunque.
 */

interface Owner {
	email: string;
	name: string;
	storeName: string;
}

async function loadOwner(storeId: string): Promise<Owner | null> {
	const row = await db.query.store.findFirst({
		where: eq(store.id, storeId),
		columns: { name: true },
		with: {
			sellerProfile: {
				columns: { firstName: true, lastName: true },
				with: { user: { columns: { email: true, name: true } } },
			},
		},
	});
	if (!row) return null;
	const { sellerProfile } = row;
	const fullName = [sellerProfile.firstName, sellerProfile.lastName]
		.filter(Boolean)
		.join(" ");
	return {
		email: sellerProfile.user.email,
		name: fullName || sellerProfile.user.name,
		storeName: row.name,
	};
}

function sellerUrl(path: string): string {
	return `${env.SELLER_APP_URL ?? "http://localhost:3002"}${path}`;
}

async function notifyOwner(
	kind: string,
	storeId: string,
	render: (owner: Owner) => Promise<RenderedEmail>,
): Promise<void> {
	try {
		const owner = await loadOwner(storeId);
		if (!owner) {
			logger.warn({ storeId, kind }, "Billing email skipped: store not found");
			return;
		}
		const { subject, html } = await render(owner);
		await sendEmail({ to: owner.email, subject, html });
		logger.info({ storeId, kind }, "Billing email sent to store owner");
	} catch (err) {
		logger.error({ err, storeId, kind }, "Billing email failed");
	}
}

export function notifyPaymentFailed(params: {
	storeId: string;
	amountCents: number;
	currency: string;
}): Promise<void> {
	return notifyOwner("payment_failed", params.storeId, (owner) =>
		renderPaymentFailedEmail({
			ownerName: owner.name,
			storeName: owner.storeName,
			amountCents: params.amountCents,
			currency: params.currency,
			billingUrl: sellerUrl("/billing"),
		}),
	);
}

export function notifyStoreSuspended(storeId: string): Promise<void> {
	return notifyOwner("store_suspended", storeId, (owner) =>
		renderStoreSuspendedEmail({
			ownerName: owner.name,
			storeName: owner.storeName,
			billingUrl: sellerUrl("/billing"),
		}),
	);
}

export function notifyStoreCanceled(params: {
	storeId: string;
	cancelReason: string;
}): Promise<void> {
	return notifyOwner("store_canceled", params.storeId, (owner) =>
		renderStoreCanceledEmail({
			ownerName: owner.name,
			storeName: owner.storeName,
			reason:
				params.cancelReason === "seller_canceled"
					? "seller_canceled"
					: "payment_failed",
			archivedUrl: sellerUrl("/store/archived"),
		}),
	);
}
