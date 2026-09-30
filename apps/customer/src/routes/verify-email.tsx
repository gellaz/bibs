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
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<Mail className="size-6" />
					</div>
					<CardTitle className="text-xl">Controlla la tua email</CardTitle>
					<CardDescription>
						{email ? (
							<>
								Abbiamo inviato un link di verifica a{" "}
								<span className="font-medium text-foreground">{email}</span>
							</>
						) : (
							"Ti abbiamo inviato un link di verifica via email."
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-center text-sm text-muted-foreground">
						Clicca sul link nell'email per verificare il tuo account.
					</p>

					{email && (
						<Button
							variant="outline"
							className="w-full"
							onClick={handleResend}
							disabled={cooldownActive || resending}
						>
							{resending
								? "Invio in corso..."
								: cooldownActive
									? m.auth_verify_email_resend_cooldown({
											seconds: String(secondsRemaining),
										})
									: "Reinvia email di verifica"}
						</Button>
					)}

					<div className="border-t pt-4">
						<Link to="/login" className="block">
							<Button variant="ghost" className="w-full">
								Torna al login
							</Button>
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
