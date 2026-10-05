import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { BrandMark } from "@bibs/ui/custom/brand-mark";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LoginForm } from "@/features/auth/components/login-form";
import type { LoginFormData } from "@/features/auth/schemas/login";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-error";
import { m } from "@/paraglide/messages";

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
					setError(m.auth_login_email_not_verified());
					return;
				}
				// Il `message` di better-auth è in inglese: si traduce dal `code`.
				setError(
					authErrorMessage(signInError, m.auth_login_invalid_credentials()),
				);
				return;
			}

			void navigate({ to: "/" });
		} catch {
			setError(m.auth_login_error());
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
					<CardDescription>{m.auth_login_subtitle()}</CardDescription>
				</CardHeader>
				<CardContent>
					<LoginForm onSubmit={handleSubmit} apiError={error} />
				</CardContent>
			</Card>
		</div>
	);
}
