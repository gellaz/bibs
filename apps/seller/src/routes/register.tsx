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
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/register")({
	component: RegisterPage,
});

function RegisterPage() {
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [vatNumber, setVatNumber] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const { data: session } = authClient.useSession();

	if (session?.user) {
		void navigate({ to: "/" });
		return null;
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError("");

		if (password !== confirmPassword) {
			setError("Le password non corrispondono");
			return;
		}

		setLoading(true);

		try {
			const { error: regError } = await api().register.seller.post({
				name,
				email,
				password,
				vatNumber,
			});

			if (regError) {
				setError(regError.value.message ?? "Errore durante la registrazione");
				return;
			}

			// Sign in automatically after registration
			const { error: signInError } = await authClient.signIn.email({
				email,
				password,
			});

			if (signInError) {
				// Registration succeeded but auto-login failed, redirect to login
				void navigate({ to: "/login" });
				return;
			}

			void navigate({ to: "/" });
		} catch {
			setError("Errore durante la registrazione. Riprova.");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground text-lg font-bold">
						B
					</div>
					<CardTitle className="text-xl">Registrati come Venditore</CardTitle>
					<CardDescription>
						Crea il tuo account per iniziare a vendere su Bibs
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						{error && (
							<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{error}
							</div>
						)}

						<div className="flex flex-col gap-2">
							<Label htmlFor="name">Nome completo</Label>
							<Input
								id="name"
								type="text"
								placeholder="Mario Rossi"
								value={name}
								onChange={(e) => setName(e.target.value)}
								required
								autoComplete="name"
								autoFocus
							/>
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								type="email"
								placeholder="venditore@esempio.it"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								autoComplete="email"
							/>
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								autoComplete="new-password"
								minLength={8}
							/>
							<p className="text-xs text-muted-foreground">
								Minimo 8 caratteri
							</p>
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="confirmPassword">Conferma password</Label>
							<Input
								id="confirmPassword"
								type="password"
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								required
								autoComplete="new-password"
								minLength={8}
							/>
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="vatNumber">Partita IVA</Label>
							<Input
								id="vatNumber"
								type="text"
								inputMode="numeric"
								placeholder="12345678901"
								value={vatNumber}
								onChange={(e) =>
									setVatNumber(e.target.value.replace(/\D/g, "").slice(0, 11))
								}
								required
								pattern="[0-9]{11}"
								maxLength={11}
							/>
							<p className="text-xs text-muted-foreground">
								11 cifre — sarà verificata da un amministratore
							</p>
						</div>

						<Button type="submit" disabled={loading} className="w-full">
							{loading ? "Registrazione in corso..." : "Registrati"}
						</Button>

						<p className="text-center text-sm text-muted-foreground">
							Hai già un account?{" "}
							<Link to="/login" className="text-primary underline">
								Accedi
							</Link>
						</p>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
