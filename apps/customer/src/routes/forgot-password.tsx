import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { Input } from "@bibs/ui/components/input";
import { toast } from "@bibs/ui/components/sonner";
import { useCooldown } from "@bibs/ui/hooks/use-cooldown";
import { createFileRoute, Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

const searchSchema = z.object({
	email: z.string().optional(),
});

export const Route = createFileRoute("/forgot-password")({
	validateSearch: searchSchema,
	component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
	const { email: emailParam } = Route.useSearch();
	const [email, setEmail] = useState(emailParam ?? "");
	const [sending, setSending] = useState(false);
	const [sentOnce, setSentOnce] = useState(false);
	const [lastSentAt, setLastSentAt] = useState<number | null>(null);
	const { secondsRemaining, ready } = useCooldown(lastSentAt ?? 0, 60_000);
	const cooldownActive = lastSentAt !== null && !ready && secondsRemaining > 0;

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (!email || sending || cooldownActive) return;
		setSending(true);
		try {
			await authClient.requestPasswordReset({
				email,
				redirectTo: `${window.location.origin}/reset-password`,
			});
			setLastSentAt(Date.now());
			setSentOnce(true);
			toast.success(m.auth_forgot_password_sent_toast());
		} catch {
			toast.error(m.auth_generic_error());
		} finally {
			setSending(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						<KeyRound className="size-6" />
					</div>
					<CardTitle className="text-xl">
						{m.auth_forgot_password_title()}
					</CardTitle>
					<CardDescription>{m.auth_forgot_password_body()}</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						<Input
							type="email"
							required
							autoComplete="email"
							placeholder="email@esempio.it"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
						<Button
							type="submit"
							className="w-full"
							disabled={sending || cooldownActive || !email}
						>
							{sending
								? m.auth_forgot_password_sending()
								: cooldownActive
									? m.auth_forgot_password_cooldown({
											seconds: String(secondsRemaining),
										})
									: m.auth_forgot_password_submit()}
						</Button>
					</form>

					{sentOnce && (
						<p className="text-center text-sm text-muted-foreground">
							{m.auth_forgot_password_sent_body()}
						</p>
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
