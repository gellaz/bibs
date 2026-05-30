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
import { PendingVerificationBannerConnected } from "@/features/auth/components/pending-verification-banner-connected";
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
	const [pending, setPending] = useState<{
		email: string;
		resentAt: number;
	} | null>(null);

	const { data: session } = authClient.useSession();

	useEffect(() => {
		if (session?.user) {
			void navigate({ to: "/" });
		}
	}, [session, navigate]);

	async function handleSubmit(data: RegisterFormData) {
		setError("");
		setPending(null);

		try {
			const { error: regError } = await api().register.seller.post({
				email: data.email,
				password: data.password,
			});

			if (regError) {
				const errVal = regError.value as {
					error?: string;
					message?: string;
					resentAt?: string;
				};

				if (errVal.error === "EMAIL_PENDING_VERIFICATION" && errVal.resentAt) {
					setPending({
						email: data.email,
						resentAt: Date.parse(errVal.resentAt),
					});
					return;
				}

				setError(errVal.message ?? "Errore durante la registrazione");
				return;
			}

			// Redirect to verify-email page (email verification required before login)
			void navigate({ to: "/verify-email", search: { email: data.email } });
		} catch {
			setError("Errore durante la registrazione. Riprova.");
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
					<CardTitle className="text-xl">Registrati come Venditore</CardTitle>
					<CardDescription>
						Crea il tuo account per iniziare a vendere su bibs
					</CardDescription>
				</CardHeader>
				<CardContent>
					<RegisterForm onSubmit={handleSubmit} apiError={error} />
					{pending && (
						<PendingVerificationBannerConnected
							email={pending.email}
							resentAt={pending.resentAt}
							onUseOtherEmail={() => setPending(null)}
						/>
					)}
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
