import { Button } from "@bibs/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { PasswordInput } from "@bibs/ui/custom/password-input";
import { zodResolver } from "@hookform/resolvers/zod";
import { type SubmitHandler, useForm } from "react-hook-form";
import {
	type RegisterFormData,
	registerFormSchema,
} from "@/features/auth/schemas/register";
import { passwordInputLabels } from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

interface RegisterFormProps {
	onSubmit: (data: RegisterFormData) => Promise<void>;
	apiError?: string;
}

export function RegisterForm({ onSubmit, apiError }: RegisterFormProps) {
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<RegisterFormData>({
		resolver: zodResolver(registerFormSchema),
		defaultValues: {
			email: "",
			password: "",
			confirmPassword: "",
		},
	});

	const onFormSubmit: SubmitHandler<RegisterFormData> = async (data) => {
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
					autoComplete="new-password"
					{...register("password")}
				/>
				<FieldDescription>{m.auth_password_hint()}</FieldDescription>
				<FieldError errors={[errors.password]} />
			</Field>

			<Field data-invalid={!!errors.confirmPassword}>
				<FieldLabel htmlFor="confirmPassword">
					{m.auth_confirm_password_label()}
				</FieldLabel>
				<PasswordInput
					labels={passwordInputLabels()}
					id="confirmPassword"
					autoComplete="new-password"
					{...register("confirmPassword")}
				/>
				<FieldError errors={[errors.confirmPassword]} />
			</Field>

			<Button type="submit" disabled={isSubmitting} className="w-full">
				{isSubmitting ? m.auth_register_submitting() : m.auth_register_submit()}
			</Button>
		</form>
	);
}
