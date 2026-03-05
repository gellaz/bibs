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
import { PasswordInput } from "@bibs/ui/components/password-input";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const registerSchema = z
	.object({
		email: z
			.string()
			.min(1, "L'email è obbligatoria")
			.email("Email non valida"),
		password: z.string().min(8, "La password deve avere almeno 8 caratteri"),
		confirmPassword: z.string().min(1, "Conferma la password"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Le password non corrispondono",
		path: ["confirmPassword"],
	});

type RegisterFormData = z.infer<typeof registerSchema>;

export const Route = createFileRoute("/register")({
	component: RegisterPage,
});

function RegisterPage() {
	const navigate = useNavigate();
	const [error, setError] = useState("");

	const { data: session } = authClient.useSession();
	if (session?.user) {
		void navigate({ to: "/" });
		return null;
	}

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<RegisterFormData>({
		resolver: zodResolver(registerSchema),
	});

	const onSubmit: SubmitHandler<RegisterFormData> = async (data) => {
		setError("");
		try {
			const { error: regError } = await api().register.customer.post({
				email: data.email,
				password: data.password,
			});

			if (regError) {
				setError(regError.value.message ?? "Errore durante la registrazione");
				return;
			}

			void navigate({ to: "/verify-email", search: { email: data.email } });
		} catch {
			setError("Errore durante la registrazione. Riprova.");
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground text-lg font-bold">
						B
					</div>
					<CardTitle className="text-xl">Crea un account</CardTitle>
					<CardDescription>
						Registrati per iniziare a fare acquisti su Bibs
					</CardDescription>
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
							<FieldLabel htmlFor="email">Email</FieldLabel>
							<Input
								id="email"
								type="email"
								placeholder="email@esempio.it"
								autoComplete="email"
								autoFocus
								{...register("email")}
							/>
							<FieldError errors={[errors.email]} />
						</Field>

						<Field data-invalid={!!errors.password}>
							<FieldLabel htmlFor="password">Password</FieldLabel>
							<PasswordInput
								id="password"
								autoComplete="new-password"
								{...register("password")}
							/>
							<FieldDescription>Minimo 8 caratteri</FieldDescription>
							<FieldError errors={[errors.password]} />
						</Field>

						<Field data-invalid={!!errors.confirmPassword}>
							<FieldLabel htmlFor="confirmPassword">
								Conferma password
							</FieldLabel>
							<PasswordInput
								id="confirmPassword"
								autoComplete="new-password"
								{...register("confirmPassword")}
							/>
							<FieldError errors={[errors.confirmPassword]} />
						</Field>

						<Button type="submit" disabled={isSubmitting} className="w-full">
							{isSubmitting ? "Registrazione in corso..." : "Registrati"}
						</Button>
					</form>

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
