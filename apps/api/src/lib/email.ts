import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

interface SendEmailParams {
	to: string;
	subject: string;
	html: string;
}

/**
 * Sends an email.
 * - In development: logs the email content (no external service needed).
 * - In production: sends via Resend API.
 */
export async function sendEmail({ to, subject, html }: SendEmailParams) {
	if (env.NODE_ENV !== "production") {
		logger.info(
			{ to, subject, html },
			"📧 Email (dev mode — not actually sent)",
		);
		return;
	}

	if (!env.RESEND_API_KEY) {
		logger.warn({ to, subject }, "⚠️ RESEND_API_KEY not set — email not sent");
		return;
	}

	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
		},
		body: JSON.stringify({
			from: env.EMAIL_FROM ?? "Bibs <noreply@bibs.it>",
			to,
			subject,
			html,
		}),
	});

	if (!res.ok) {
		const body = await res.text();
		logger.error(
			{ to, subject, status: res.status, body },
			"Failed to send email via Resend",
		);
	}
}
