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
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircleIcon } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { richMessage } from "@/lib/rich-message";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/invite/$token")({
	component: AcceptInvitePage,
});

function AcceptInvitePage() {
	const { token } = Route.useParams();

	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [apiError, setApiError] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [success, setSuccess] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setApiError("");

		if (password.length < 8) {
			setApiError(m.auth_password_min());
			return;
		}

		if (password !== confirmPassword) {
			setApiError(m.auth_invite_password_mismatch());
			return;
		}

		setIsSubmitting(true);
		try {
			const response = await api().register["accept-invite"].post({
				token,
				password,
				confirmPassword,
			});

			if (response.error) {
				// The API error envelope is always an object { success, error, message };
				// surface the server's message (e.g. expired token, password mismatch)
				// instead of always collapsing to the generic fallback.
				const value = response.error.value as { message?: string } | null;
				setApiError(value?.message ?? m.auth_invite_create_error());
				return;
			}

			setSuccess(true);
		} catch {
			setApiError(m.auth_invite_network_error());
		} finally {
			setIsSubmitting(false);
		}
	}

	if (success) {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<Card className="w-full max-w-sm text-center">
					<CardHeader>
						<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-green-100">
							<CheckCircleIcon className="size-6 text-green-600" />
						</div>
						<CardTitle className="text-xl">
							{m.auth_invite_success_title()}
						</CardTitle>
						<CardDescription>{m.auth_invite_success_body()}</CardDescription>
					</CardHeader>
					<CardContent>
						<Link to="/login" className="text-sm text-primary underline">
							{m.auth_invite_go_to_login()}
						</Link>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<BrandMark className="mx-auto mb-2 size-12" />
					<CardTitle className="text-xl">{m.auth_invite_title()}</CardTitle>
					<CardDescription>{m.auth_invite_description()}</CardDescription>
				</CardHeader>
				<CardContent>
					{apiError && (
						<div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{apiError}
						</div>
					)}

					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="password">{m.auth_password_label()}</Label>
							<Input
								id="password"
								type="password"
								placeholder={m.auth_password_hint()}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								disabled={isSubmitting}
								minLength={8}
								required
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="confirmPassword">
								{m.auth_confirm_password_label()}
							</Label>
							<Input
								id="confirmPassword"
								type="password"
								placeholder={m.auth_invite_confirm_placeholder()}
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								disabled={isSubmitting}
								minLength={8}
								required
							/>
						</div>

						<Button type="submit" disabled={isSubmitting} className="w-full">
							{isSubmitting
								? m.auth_invite_submitting()
								: m.auth_invite_submit()}
						</Button>
					</form>

					<p className="mt-4 text-center text-sm text-muted-foreground">
						{richMessage(m.auth_have_account({ link: "{link}" }), {
							link: (
								<Link to="/login" className="text-primary underline">
									{m.auth_login_submit()}
								</Link>
							),
						})}
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
