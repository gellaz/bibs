import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { RegisterForm } from "@/features/auth/components/register-form";
import type { RegisterFormData } from "@/features/auth/schemas/register";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/register")({
	component: RegisterPage,
});

function RegisterPage() {
	const navigate = useNavigate();
	const [error, setError] = useState("");

	const { data: session } = authClient.useSession();

	if (session?.user) {
		void navigate({ to: "/" });
		return null;
	}

	async function handleSubmit(data: RegisterFormData) {
		setError("");

		try {
			const { error: regError } = await api().register.seller.post({
				name: data.name,
				email: data.email,
				password: data.password,
				vatNumber: data.vatNumber,
			});

			if (regError) {
				setError(regError.value.message ?? "Errore durante la registrazione");
				return;
			}

			// Sign in automatically after registration
			const { error: signInError } = await authClient.signIn.email({
				email: data.email,
				password: data.password,
			});

			if (signInError) {
				// Registration succeeded but auto-login failed, redirect to login
				void navigate({ to: "/login" });
				return;
			}

			void navigate({ to: "/" });
		} catch {
			setError("Errore durante la registrazione. Riprova.");
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
					<RegisterForm onSubmit={handleSubmit} apiError={error} />
					<p className="mt-4 text-center text-sm text-muted-foreground">
						Hai già un account?{" "}
						<Link to="/login" className="text-primary underline">
							Accedi
						</Link>
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
