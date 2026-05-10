import { BrandMark } from "@bibs/ui/components/brand-mark";
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { PasswordInput } from "@bibs/ui/components/password-input";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
	component: LoginPage,
});

function LoginPage() {
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [emailNotVerified, setEmailNotVerified] = useState("");
	const [loading, setLoading] = useState(false);

	const { data: session } = authClient.useSession();

	if (session?.user) {
		void navigate({ to: "/" });
		return null;
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setEmailNotVerified("");
		setLoading(true);

		try {
			const { error: signInError } = await authClient.signIn.email({
				email,
				password,
			});

			if (signInError) {
				if (signInError.status === 403) {
					setEmailNotVerified(email);
					return;
				}
				setError(signInError.message ?? "Credenziali non valide");
				return;
			}

			void navigate({ to: "/" });
		} catch {
			setError("Errore durante il login. Riprova.");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<BrandMark className="mx-auto mb-2 size-12" />
					<CardTitle className="font-display text-xl">bibs</CardTitle>
					<CardDescription>Accedi con le tue credenziali</CardDescription>
				</CardHeader>
				<CardContent>
					{emailNotVerified && (
						<div className="mb-4 rounded-md bg-saffron/15 dark:bg-saffron/10 px-3 py-2 text-sm text-saffron-deep dark:text-saffron">
							<p>Devi verificare la tua email prima di accedere.</p>
							<Link
								to="/verify-email"
								search={{ email: emailNotVerified }}
								className="font-medium underline"
							>
								Reinvia email di verifica
							</Link>
						</div>
					)}
					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						{error && (
							<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{error}
							</div>
						)}

						<div className="flex flex-col gap-2">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								type="email"
								placeholder="email@esempio.it"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								autoComplete="email"
								autoFocus
							/>
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="password">Password</Label>
							<PasswordInput
								id="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								autoComplete="current-password"
							/>
						</div>

						<Button type="submit" disabled={loading} className="w-full">
							{loading ? "Accesso in corso..." : "Accedi"}
						</Button>
					</form>

					<p className="mt-4 text-center text-sm text-muted-foreground">
						Non hai un account?{" "}
						<Link to="/register" className="text-primary underline">
							Registrati
						</Link>
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
