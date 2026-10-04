import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { BrandMark } from "@bibs/ui/custom/brand-mark";
import { PasswordInput } from "@bibs/ui/custom/password-input";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";
import { AuthLocaleFooter } from "@/components/auth-locale-footer";
import { PendingVerificationBannerConnected } from "@/features/auth/components/pending-verification-banner-connected";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

/**
 * Costruito a ogni render, non a livello di modulo: i messaggi di Zod vanno
 * risolti nella lingua corrente, non in quella attiva al primo import.
 */
function buildRegisterSchema() {
	return z
		.object({
			email: z
				.string()
				.min(1, m.auth_register_email_required())
				.email(m.auth_register_email_invalid()),
			password: z.string().min(8, m.auth_register_password_too_short()),
			confirmPassword: z.string().min(1, m.auth_register_confirm_required()),
		})
		.refine((data) => data.password === data.confirmPassword, {
			message: m.auth_register_password_mismatch(),
			path: ["confirmPassword"],
		});
}

type RegisterFormData = z.infer<ReturnType<typeof buildRegisterSchema>>;

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

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<RegisterFormData>({
		resolver: zodResolver(buildRegisterSchema()),
	});

	useEffect(() => {
		if (session?.user) {
			void navigate({ to: "/" });
		}
	}, [session, navigate]);

	const onSubmit: SubmitHandler<RegisterFormData> = async (data) => {
		setError("");
		setPending(null);
		try {
			const { error: regError } = await api().register.customer.post({
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

				setError(errVal.message ?? m.auth_register_error());
				return;
			}

			void navigate({
				to: "/verify-email",
				search: { email: data.email, sentAt: Date.now() },
			});
		} catch {
			setError(m.auth_register_error_retry());
		}
	};

	if (session?.user) {
		return null;
	}

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<BrandMark className="mx-auto mb-2 size-12" />
					<CardTitle className="text-xl">{m.auth_register_title()}</CardTitle>
					<CardDescription>{m.auth_register_description()}</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={handleSubmit(onSubmit)}
						className="flex flex-col gap-4"
					>
						{error && (
							<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{error}
							</div>
						)}

						<Field data-invalid={!!errors.email}>
							<FieldLabel htmlFor="email">{m.auth_email_label()}</FieldLabel>
							<Input
								id="email"
								type="email"
								placeholder={m.auth_email_placeholder()}
								autoComplete="email"
								autoFocus
								{...register("email")}
							/>
							<FieldError errors={[errors.email]} />
						</Field>

						<Field data-invalid={!!errors.password}>
							<FieldLabel htmlFor="password">
								{m.auth_password_label()}
							</FieldLabel>
							<PasswordInput
								labels={{ show: m.password_show(), hide: m.password_hide() }}
								id="password"
								autoComplete="new-password"
								{...register("password")}
							/>
							<FieldDescription>
								{m.auth_register_password_hint()}
							</FieldDescription>
							<FieldError errors={[errors.password]} />
						</Field>

						<Field data-invalid={!!errors.confirmPassword}>
							<FieldLabel htmlFor="confirmPassword">
								{m.auth_register_confirm_label()}
							</FieldLabel>
							<PasswordInput
								labels={{ show: m.password_show(), hide: m.password_hide() }}
								id="confirmPassword"
								autoComplete="new-password"
								{...register("confirmPassword")}
							/>
							<FieldError errors={[errors.confirmPassword]} />
						</Field>

						<Button type="submit" disabled={isSubmitting} className="w-full">
							{isSubmitting
								? m.auth_register_submitting()
								: m.auth_register_submit()}
						</Button>
					</form>

					{pending && (
						<PendingVerificationBannerConnected
							email={pending.email}
							resentAt={pending.resentAt}
							onUseOtherEmail={() => setPending(null)}
						/>
					)}

					<p className="mt-4 text-center text-sm text-muted-foreground">
						{m.auth_register_have_account()}{" "}
						<Link to="/login" className="text-primary underline">
							{m.auth_register_login_link()}
						</Link>
					</p>
				</CardContent>
			</Card>
			<AuthLocaleFooter />
		</div>
	);
}
