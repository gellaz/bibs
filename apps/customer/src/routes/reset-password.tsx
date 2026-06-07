import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { PasswordInput } from "@bibs/ui/components/password-input";
import { toast } from "@bibs/ui/components/sonner";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

const searchSchema = z.object({
	token: z.string().optional(),
	error: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
	validateSearch: searchSchema,
	component: ResetPasswordPage,
});

function ResetPasswordPage() {
	const navigate = useNavigate();
	const { token, error } = Route.useSearch();
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const invalidToken = !token || error === "INVALID_TOKEN";

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (submitting || !token) return;
		if (password.length < 8) {
			setFormError(m.auth_reset_password_too_short());
			return;
		}
		if (password !== confirmPassword) {
			setFormError(m.auth_reset_password_mismatch());
			return;
		}
		setFormError(null);
		setSubmitting(true);
		try {
			const res = await authClient.resetPassword({
				newPassword: password,
				token,
			});
			if (res.error) {
				setFormError(m.auth_reset_password_invalid_token());
				return;
			}
			toast.success(m.auth_reset_password_success_toast());
			void navigate({ to: "/login" });
		} catch {
			toast.error(m.auth_generic_error());
		} finally {
			setSubmitting(false);
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
						{m.auth_reset_password_title()}
					</CardTitle>
					<CardDescription>
						{invalidToken
							? m.auth_reset_password_invalid_token()
							: m.auth_reset_password_body()}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{invalidToken ? (
						<Link to="/forgot-password" className="block">
							<Button className="w-full">
								{m.auth_reset_password_request_new()}
							</Button>
						</Link>
					) : (
						<form onSubmit={handleSubmit} className="flex flex-col gap-4">
							<PasswordInput
								required
								autoComplete="new-password"
								placeholder={m.auth_reset_password_new_label()}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
							<PasswordInput
								required
								autoComplete="new-password"
								placeholder={m.auth_reset_password_confirm_label()}
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
							/>
							{formError && (
								<p className="text-sm text-destructive">{formError}</p>
							)}
							<Button type="submit" className="w-full" disabled={submitting}>
								{submitting
									? m.auth_reset_password_submitting()
									: m.auth_reset_password_submit()}
							</Button>
						</form>
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
