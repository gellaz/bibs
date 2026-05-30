import { BrandMark } from "@bibs/ui/components/brand-mark";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LoginForm } from "@/features/auth/components/login-form";
import type { LoginFormData } from "@/features/auth/schemas/login";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/login")({
	component: LoginPage,
});

function LoginPage() {
	const navigate = useNavigate();
	const [error, setError] = useState("");
	const [emailNotVerified, setEmailNotVerified] = useState("");

	const { data: session } = authClient.useSession();

	useEffect(() => {
		if (session?.user) {
			void navigate({ to: "/" });
		}
	}, [session, navigate]);

	async function handleSubmit(data: LoginFormData) {
		setError("");
		setEmailNotVerified("");

		try {
			const { error: signInError } = await authClient.signIn.email({
				email: data.email,
				password: data.password,
			});

			if (signInError) {
				// 403 = email not verified
				if (signInError.status === 403) {
					setEmailNotVerified(data.email);
					return;
				}
				setError(signInError.message ?? "Credenziali non valide");
				return;
			}

			void navigate({ to: "/" });
		} catch {
			setError("Errore durante il login. Riprova.");
		}
	}

	if (session?.user) {
		return null;
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<BrandMark className="mx-auto mb-2 size-12" />
					<CardTitle className="font-display text-xl">bibs Seller</CardTitle>
					<CardDescription>
						Accedi con le tue credenziali venditore
					</CardDescription>
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
					<LoginForm onSubmit={handleSubmit} apiError={error} />
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
