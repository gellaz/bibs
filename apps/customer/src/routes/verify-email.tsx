import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const searchSchema = z.object({
	email: z.string().optional(),
});

export const Route = createFileRoute("/verify-email")({
	validateSearch: searchSchema,
	component: VerifyEmailPage,
});

function VerifyEmailPage() {
	const { email } = Route.useSearch();
	const [resending, setResending] = useState(false);
	const [resent, setResent] = useState(false);

	async function handleResend() {
		if (!email || resending) return;
		setResending(true);
		try {
			await authClient.sendVerificationEmail({ email });
			setResent(true);
		} catch {
			// silently fail
		} finally {
			setResending(false);
		}
	}

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
							disabled={resending || resent}
						>
							{resent
								? "Email inviata!"
								: resending
									? "Invio in corso..."
									: "Reinvia email di verifica"}
						</Button>
					)}

					{resent && (
						<p className="text-center text-sm text-green-600 dark:text-green-400">
							Email di verifica reinviata con successo.
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
