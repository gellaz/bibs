import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { toast } from "@bibs/ui/components/sonner";
import { sentAtFromSearch, useCooldown } from "@bibs/ui/hooks/use-cooldown";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AuthLocaleFooter } from "@/components/auth-locale-footer";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

const searchSchema = z.object({
	email: z.string().optional(),
	/**
	 * Epoch ms dell'invio appena fatto: lo passa solo la registrazione. Dal
	 * login (email non verificata) non è partito niente, quindi niente attesa.
	 */
	sentAt: z.coerce.number().int().positive().optional().catch(undefined),
});

export const Route = createFileRoute("/verify-email")({
	validateSearch: searchSchema,
	component: VerifyEmailPage,
});

function VerifyEmailPage() {
	const { email, sentAt } = Route.useSearch();
	const [lastSentAt, setLastSentAt] = useState<number | null>(() =>
		sentAtFromSearch(sentAt, Date.now()),
	);
	const { secondsRemaining, ready } = useCooldown(lastSentAt, 60_000);
	const [resending, setResending] = useState(false);

	async function handleResend() {
		if (!email || !ready || resending) return;
		setResending(true);
		try {
			// better-auth non lancia: un 429 o un 500 arrivano in `error`.
			const { error } = await authClient.sendVerificationEmail({
				email,
				callbackURL: `${window.location.origin}/login`,
			});
			if (error) {
				toast.error(m.auth_verify_email_resend_error());
				return;
			}
			setLastSentAt(Date.now());
			toast.success(m.auth_verify_email_resent_toast());
		} catch {
			toast.error(m.auth_verify_email_resend_error());
		} finally {
			setResending(false);
		}
	}

	const cooldownActive = !ready && secondsRemaining > 0;

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<Mail className="size-6" />
					</div>
					<CardTitle className="text-xl">
						{m.auth_verify_email_title()}
					</CardTitle>
					<CardDescription>
						{email ? (
							<>
								{/* Solo il prefisso: l'email resta in coda in grassetto. */}
								{m.auth_verify_email_sent_to()}{" "}
								<span className="font-medium text-foreground">{email}</span>
							</>
						) : (
							m.auth_verify_email_sent_generic()
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-center text-sm text-muted-foreground">
						{m.auth_verify_email_instructions()}
					</p>

					{email && (
						<Button
							variant="outline"
							className="w-full"
							onClick={handleResend}
							disabled={cooldownActive || resending}
						>
							{resending
								? m.auth_verify_email_sending()
								: cooldownActive
									? m.auth_verify_email_resend_cooldown({
											seconds: String(secondsRemaining),
										})
									: m.auth_verify_email_resend_cta()}
						</Button>
					)}

					<div className="border-t pt-4">
						<Link to="/login" className="block">
							<Button variant="ghost" className="w-full">
								{m.auth_back_to_login()}
							</Button>
						</Link>
					</div>
				</CardContent>
			</Card>
			<AuthLocaleFooter />
		</div>
	);
}
