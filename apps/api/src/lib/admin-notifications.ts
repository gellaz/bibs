import { renderAdminNewRequestEmail } from "@bibs/emails";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { sellerProfile } from "@/db/schemas/seller";
import { sendEmail } from "@/infra/email";
import { env } from "@/infra/env";
import { logger } from "@/infra/logger";

/**
 * Avviso agli admin per ogni nuova candidatura o richiesta di modifica.
 * Si chiama DOPO la scrittura sul DB e non lancia mai: come `notifySeller`,
 * un'email che non parte non deve far fallire la richiesta già salvata.
 */
export async function notifyAdminsNewRequest(params: {
	kind: "candidature" | "vat" | "document";
	sellerProfileId: string;
	changeId?: string;
}): Promise<void> {
	const { kind, sellerProfileId, changeId } = params;
	try {
		const profile = await db.query.sellerProfile.findFirst({
			where: eq(sellerProfile.id, sellerProfileId),
			columns: {},
			with: {
				user: { columns: { name: true, email: true } },
				organization: { columns: { businessName: true } },
			},
		});
		if (!profile) {
			logger.warn(
				{ sellerProfileId, kind },
				"Admin email skipped: seller not found",
			);
			return;
		}
		const owner = profile.user.name.trim() || profile.user.email;
		const sellerName = profile.organization
			? `${owner} (${profile.organization.businessName})`
			: owner;
		const path =
			kind === "candidature"
				? `/sellers/${sellerProfileId}`
				: `/requests/${changeId}`;
		const { subject, html } = await renderAdminNewRequestEmail({
			kind,
			sellerName,
			requestUrl: `${env.ADMIN_APP_URL ?? "http://localhost:3003"}${path}`,
		});

		const admins = await db
			.select({ email: user.email })
			.from(user)
			.where(and(eq(user.role, "admin"), sql`${user.banned} IS NOT TRUE`));
		// Un invio che fallisce non deve fermare gli altri admin.
		const results = await Promise.allSettled(
			admins.map((a) => sendEmail({ to: a.email, subject, html })),
		);
		for (const r of results) {
			if (r.status === "rejected") {
				logger.error(
					{ err: r.reason, sellerProfileId, kind },
					"Admin email failed",
				);
			}
		}
	} catch (err) {
		logger.error({ err, sellerProfileId, kind }, "Admin email failed");
	}
}
