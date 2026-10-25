import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

interface SendEmailParams {
	to: string;
	subject: string;
	html: string;
}

const DEFAULT_MAILPIT_URL = "http://localhost:8025";

/** Maps our params to Mailpit's PascalCase `POST /api/v1/send` JSON body. */
export function toMailpitPayload({ to, subject, html }: SendEmailParams) {
	return {
		// Dev-only: From is cosmetic in Mailpit; the prod path honors env.EMAIL_FROM.
		From: { Email: "noreply@bibs.it", Name: "bibs" },
		To: [{ Email: to }],
		Subject: subject,
		HTML: html,
	};
}

/**
 * Dev-only: submit the email to the local Mailpit catcher (web UI on :8025).
 * Best-effort — returns false instead of throwing, so `bun run dev` without
 * the docker infra keeps working (the caller falls back to logging).
 */
export async function sendEmailToMailpit(
	params: SendEmailParams,
	baseUrl: string,
): Promise<boolean> {
	try {
		const res = await fetch(`${baseUrl}/api/v1/send`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(toMailpitPayload(params)),
			signal: AbortSignal.timeout(2000),
		});
		if (!res.ok) throw new Error(`Mailpit responded ${res.status}`);
		return true;
	} catch (err) {
		logger.warn(
			{ err },
			"⚠️ Mailpit delivery failed — falling back to log output",
		);
		return false;
	}
}

/**
 * Sends an email.
 * - In development: delivers to the local Mailpit catcher (web UI on :8025);
 *   falls back to logging the content if Mailpit is down.
 * - In test: logs the email content (no external service needed).
 * - In production: sends via Resend API; throws if it can't, so callers that
 *   report the outcome (e.g. "Invito reinviato") don't lie.
 */
export async function sendEmail({ to, subject, html }: SendEmailParams) {
	if (env.NODE_ENV === "development") {
		const mailpitUrl = env.MAILPIT_URL ?? DEFAULT_MAILPIT_URL;
		const delivered = await sendEmailToMailpit(
			{ to, subject, html },
			mailpitUrl,
		);
		if (delivered) {
			logger.info({ to, subject, mailpitUrl }, "📧 Email delivered to Mailpit");
			return;
		}
	}

	if (env.NODE_ENV !== "production") {
		logger.info(
			{ to, subject, html },
			"📧 Email (dev mode — not actually sent)",
		);
		return;
	}

	if (!env.RESEND_API_KEY) {
		logger.warn({ to, subject }, "⚠️ RESEND_API_KEY not set — email not sent");
		throw new Error("RESEND_API_KEY not set");
	}

	await sendEmailToResend(
		{ to, subject, html },
		env.RESEND_API_KEY,
		env.EMAIL_FROM ?? "bibs <noreply@bibs.it>",
	);
}

/**
 * Production delivery via Resend. Callers await it on user-facing requests
 * (onboarding, moderation), so a hanging Resend must time out, not block them.
 */
export async function sendEmailToResend(
	{ to, subject, html }: SendEmailParams,
	apiKey: string,
	from: string,
) {
	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({ from, to, subject, html }),
		signal: AbortSignal.timeout(5000),
	});

	if (!res.ok) {
		const body = await res.text();
		logger.error(
			{ to, subject, status: res.status, body },
			"Failed to send email via Resend",
		);
		throw new Error(`Resend responded ${res.status}`);
	}
}
