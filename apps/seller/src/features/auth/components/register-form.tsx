import { Button } from "@bibs/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { type SubmitHandler, useForm } from "react-hook-form";
import {
	type RegisterFormData,
	registerFormSchema,
} from "@/features/auth/schemas/register";

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
			name: "",
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

			<Field data-invalid={!!errors.name}>
				<FieldLabel htmlFor="name">Nome completo</FieldLabel>
				<Input
					id="name"
					type="text"
					placeholder="Mario Rossi"
					autoComplete="name"
					autoFocus
					{...register("name")}
				/>
				<FieldError errors={[errors.name]} />
			</Field>

			<Field data-invalid={!!errors.email}>
				<FieldLabel htmlFor="email">Email</FieldLabel>
				<Input
					id="email"
					type="email"
					placeholder="venditore@esempio.it"
					autoComplete="email"
					{...register("email")}
				/>
				<FieldError errors={[errors.email]} />
			</Field>

			<Field data-invalid={!!errors.password}>
				<FieldLabel htmlFor="password">Password</FieldLabel>
				<Input
					id="password"
					type="password"
					autoComplete="new-password"
					{...register("password")}
				/>
				<FieldDescription>Minimo 8 caratteri</FieldDescription>
				<FieldError errors={[errors.password]} />
			</Field>

			<Field data-invalid={!!errors.confirmPassword}>
				<FieldLabel htmlFor="confirmPassword">Conferma password</FieldLabel>
				<Input
					id="confirmPassword"
					type="password"
					autoComplete="new-password"
					{...register("confirmPassword")}
				/>
				<FieldError errors={[errors.confirmPassword]} />
			</Field>

			<Button type="submit" disabled={isSubmitting} className="w-full">
				{isSubmitting ? "Registrazione in corso..." : "Registrati"}
			</Button>
		</form>
	);
}
