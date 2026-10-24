import {
	type RenderedEmail,
	renderSellerApplicationReceivedEmail,
	renderSellerApprovedEmail,
	renderSellerRejectedEmail,
} from "@bibs/emails";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sellerProfile } from "@/db/schemas/seller";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { SellerRejectionFixStep } from "@/lib/schemas/forms";

/**
 * Email della candidatura al venditore (titolare del seller_profile).
 *
 * Si chiamano DOPO la scrittura sul DB e non lanciano mai: un'email che non
 * parte non deve far fallire l'onboarding né la moderazione, la transizione di
 * stato è già scritta.
 */

interface Seller {
	email: string;
	firstName: string | null;
}

async function loadSeller(sellerProfileId: string): Promise<Seller | null> {
	const row = await db.query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, sellerProfileId),
		columns: { firstName: true },
		with: { user: { columns: { email: true } } },
	});
	if (!row) return null;
	return { email: row.user.email, firstName: row.firstName };
}

function sellerUrl(path: string): string {
	return `${env.SELLER_APP_URL ?? "http://localhost:3002"}${path}`;
}

async function notifySeller(
	kind: string,
	sellerProfileId: string,
	render: (seller: Seller) => Promise<RenderedEmail>,
): Promise<void> {
	try {
		const seller = await loadSeller(sellerProfileId);
		if (!seller) {
			logger.warn(
				{ sellerProfileId, kind },
				"Onboarding email skipped: seller not found",
			);
			return;
		}
		const { subject, html } = await render(seller);
		await sendEmail({ to: seller.email, subject, html });
		logger.info({ sellerProfileId, kind }, "Onboarding email sent to seller");
	} catch (err) {
		logger.error({ err, sellerProfileId, kind }, "Onboarding email failed");
	}
}

export function notifyApplicationReceived(
	sellerProfileId: string,
): Promise<void> {
	return notifySeller("application_received", sellerProfileId, (seller) =>
		renderSellerApplicationReceivedEmail({ firstName: seller.firstName }),
	);
}

export function notifySellerApproved(sellerProfileId: string): Promise<void> {
	return notifySeller("seller_approved", sellerProfileId, (seller) =>
		renderSellerApprovedEmail({
			firstName: seller.firstName,
			sellerUrl: sellerUrl("/"),
		}),
	);
}

export function notifySellerRejected(params: {
	sellerProfileId: string;
	reason: string;
	fixStep: SellerRejectionFixStep | null;
}): Promise<void> {
	const { sellerProfileId, reason, fixStep } = params;
	return notifySeller("seller_rejected", sellerProfileId, (seller) =>
		renderSellerRejectedEmail({
			firstName: seller.firstName,
			reason,
			fix: fixStep
				? { step: fixStep, url: sellerUrl(`/onboarding/${fixStep}`) }
				: null,
			supportEmail: env.SUPPORT_EMAIL,
		}),
	);
}
