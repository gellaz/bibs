import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { PasswordInput } from "@bibs/ui/custom/password-input";
import { type SubmitHandler, useForm } from "react-hook-form";
import {
	type LoginFormData,
	loginFormSchema,
} from "@/features/auth/schemas/login";
import { passwordInputLabels } from "@/lib/ui-labels";
import { zodResolver } from "@/lib/zod-resolver";
import { m } from "@/paraglide/messages";

interface LoginFormProps {
	onSubmit: (data: LoginFormData) => Promise<void>;
	apiError?: string;
}

export function LoginForm({ onSubmit, apiError }: LoginFormProps) {
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<LoginFormData>({
		resolver: zodResolver(loginFormSchema),
		defaultValues: { email: "", password: "" },
	});

	const onFormSubmit: SubmitHandler<LoginFormData> = async (data) => {
		await onSubmit(data);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)} className="flex flex-col gap-4">
			{apiError && (
				<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{apiError}
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
				<FieldLabel htmlFor="password">{m.auth_password_label()}</FieldLabel>
				<PasswordInput
					labels={passwordInputLabels()}
					id="password"
					autoComplete="current-password"
					{...register("password")}
				/>
				<FieldError errors={[errors.password]} />
			</Field>

			<Button type="submit" disabled={isSubmitting} className="w-full">
				{isSubmitting ? m.auth_login_submitting() : m.auth_login_submit()}
			</Button>
		</form>
	);
}
