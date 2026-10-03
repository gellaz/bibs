import { m } from "@/paraglide/messages";

interface AuthClientError {
	code?: string;
	status?: number;
}

/**
 * better-auth risponde con `message` in inglese: in UI usiamo solo il `code`
 * (o lo status) e ricadiamo su `fallback` per tutto ciò che non conosciamo.
 */
export function authErrorMessage(
	error: AuthClientError,
	fallback: string,
): string {
	if (error.status === 429) return m.auth_error_too_many_requests();
	switch (error.code) {
		case "INVALID_EMAIL_OR_PASSWORD":
			return m.auth_login_invalid_credentials();
		case "PASSWORD_TOO_SHORT":
			return m.auth_reset_password_too_short();
		case "PASSWORD_TOO_LONG":
			return m.auth_reset_password_too_long();
		case "INVALID_TOKEN":
			return m.auth_reset_password_invalid_token();
		default:
			return fallback;
	}
}
