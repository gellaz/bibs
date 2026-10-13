import { m } from "@/paraglide/messages";

/**
 * Banner del login quando si arriva dal link di verifica email: better-auth
 * reindirizza a `/login?verified=1` e aggiunge `&error=…` se il link è
 * scaduto o non valido. L'errore vince.
 */
export function VerifyLinkNotice({
	verified,
	error,
}: {
	verified?: boolean;
	error?: string;
}) {
	if (error) {
		return (
			<div
				role="alert"
				className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
			>
				{m.auth_login_verify_link_invalid()}
			</div>
		);
	}
	if (verified) {
		return (
			<div
				role="status"
				className="mb-4 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-foreground"
			>
				{m.auth_login_email_verified()}
			</div>
		);
	}
	return null;
}
