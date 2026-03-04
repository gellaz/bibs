import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const profileSchema = z.object({
	firstName: z.string().min(1, "Il nome è obbligatorio"),
	lastName: z.string().min(1, "Il cognome è obbligatorio"),
	birthDate: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export const Route = createFileRoute("/_authenticated/profile")({
	component: ProfilePage,
});

function ProfilePage() {
	const { data: session } = authClient.useSession();
	const [success, setSuccess] = useState(false);
	const [apiError, setApiError] = useState("");

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors, isSubmitting, isDirty },
	} = useForm<ProfileFormData>({
		resolver: zodResolver(profileSchema),
	});

	useEffect(() => {
		if (session?.user) {
			reset({
				firstName: session.user.firstName ?? "",
				lastName: session.user.lastName ?? "",
				birthDate: session.user.birthDate ?? "",
			});
		}
	}, [session, reset]);

	const onSubmit: SubmitHandler<ProfileFormData> = async (data) => {
		setApiError("");
		setSuccess(false);
		try {
			const { error } = await authClient.updateUser({
				firstName: data.firstName,
				lastName: data.lastName,
				birthDate: data.birthDate || undefined,
				name: `${data.firstName} ${data.lastName}`,
			});
			if (error) {
				setApiError(error.message ?? "Errore durante il salvataggio");
				return;
			}
			setSuccess(true);
		} catch {
			setApiError("Errore durante il salvataggio. Riprova.");
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Il mio profilo</CardTitle>
					<CardDescription>
						Aggiorna le tue informazioni personali
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={handleSubmit(onSubmit)}
						className="flex flex-col gap-4"
					>
						{apiError && (
							<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{apiError}
							</div>
						)}
						{success && (
							<div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
								Profilo aggiornato con successo
							</div>
						)}

						<div className="grid grid-cols-2 gap-4">
							<Field data-invalid={!!errors.firstName}>
								<FieldLabel htmlFor="firstName">Nome</FieldLabel>
								<Input
									id="firstName"
									placeholder="Mario"
									autoFocus
									{...register("firstName")}
								/>
								<FieldError errors={[errors.firstName]} />
							</Field>

							<Field data-invalid={!!errors.lastName}>
								<FieldLabel htmlFor="lastName">Cognome</FieldLabel>
								<Input
									id="lastName"
									placeholder="Rossi"
									{...register("lastName")}
								/>
								<FieldError errors={[errors.lastName]} />
							</Field>
						</div>

						<Field data-invalid={!!errors.birthDate}>
							<FieldLabel htmlFor="birthDate">Data di nascita</FieldLabel>
							<Input id="birthDate" type="date" {...register("birthDate")} />
							<FieldError errors={[errors.birthDate]} />
						</Field>

						<Button
							type="submit"
							disabled={isSubmitting || !isDirty}
							className="w-full mt-2"
						>
							{isSubmitting ? "Salvataggio..." : "Salva modifiche"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
