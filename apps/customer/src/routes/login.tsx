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
import { BrandMark } from "@bibs/ui/custom/brand-mark";
import { PasswordInput } from "@bibs/ui/custom/password-input";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

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

	useEffect(() => {
		if (session?.user) {
			void navigate({ to: "/" });
		}
	}, [session, navigate]);

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
				setError(signInError.message ?? m.auth_login_invalid_credentials());
				return;
			}

			void navigate({ to: "/" });
		} catch {
			setError(m.auth_login_error());
		} finally {
			setLoading(false);
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
					<CardTitle className="font-display text-xl">bibs</CardTitle>
					<CardDescription>{m.auth_login_description()}</CardDescription>
				</CardHeader>
				<CardContent>
					{emailNotVerified && (
						<div className="mb-4 rounded-md bg-saffron/15 dark:bg-saffron/10 px-3 py-2 text-sm text-saffron-deep dark:text-saffron">
							<p>{m.auth_login_email_not_verified()}</p>
							<Link
								to="/verify-email"
								search={{ email: emailNotVerified }}
								className="font-medium underline"
							>
								{m.auth_login_resend_verification()}
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
							<Label htmlFor="email">{m.auth_email_label()}</Label>
							<Input
								id="email"
								type="email"
								placeholder={m.auth_email_placeholder()}
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								autoComplete="email"
								autoFocus
							/>
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="password">{m.auth_password_label()}</Label>
							<PasswordInput
								id="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								autoComplete="current-password"
							/>
						</div>

						<Button type="submit" disabled={loading} className="w-full">
							{loading ? m.auth_login_submitting() : m.auth_login_submit()}
						</Button>
						<Link
							to="/forgot-password"
							className="text-center text-sm text-muted-foreground hover:underline"
						>
							{m.auth_login_forgot_password()}
						</Link>
					</form>

					<p className="mt-4 text-center text-sm text-muted-foreground">
						{m.auth_login_no_account()}{" "}
						<Link to="/register" className="text-primary underline">
							{m.auth_login_register_link()}
						</Link>
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
