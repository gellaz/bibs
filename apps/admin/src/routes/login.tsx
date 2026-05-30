import { BrandMark } from "@bibs/ui/components/brand-mark";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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

	const { data: session } = authClient.useSession();

	// Se già autenticato come admin, redirect alla dashboard
	useEffect(() => {
		if (session?.user?.role === "admin") {
			void navigate({ to: "/" });
		}
	}, [session, navigate]);

	async function handleSubmit(data: LoginFormData) {
		setError("");

		try {
			const { error: signInError } = await authClient.signIn.email({
				email: data.email,
				password: data.password,
			});

			if (signInError) {
				if (signInError.status === 403) {
					setError("Email non verificata. Controlla la tua casella di posta.");
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

	if (session?.user?.role === "admin") {
		return null;
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<BrandMark className="mx-auto mb-2 size-12" />
					<CardTitle className="font-display text-xl">bibs Admin</CardTitle>
					<CardDescription>
						Accedi con le tue credenziali amministratore
					</CardDescription>
				</CardHeader>
				<CardContent>
					<LoginForm onSubmit={handleSubmit} apiError={error} />
				</CardContent>
			</Card>
		</div>
	);
}
