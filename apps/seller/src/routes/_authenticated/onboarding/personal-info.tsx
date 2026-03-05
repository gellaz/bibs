import { PersonalInfoBody } from "@bibs/api/schemas";
import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import { useCountries } from "@/hooks/use-countries";
import { useUpdatePersonalInfo } from "@/hooks/use-onboarding";

type PersonalInfoFormData = Static<typeof PersonalInfoBody>;
const compiledSchema = TypeCompiler.Compile(PersonalInfoBody);

export const Route = createFileRoute(
	"/_authenticated/onboarding/personal-info",
)({
	component: PersonalInfoPage,
});

function PersonalInfoPage() {
	const navigate = useNavigate();
	const mutation = useUpdatePersonalInfo();
	const { data: countries = [] } = useCountries();
	const [apiError, setApiError] = useState("");

	const {
		register,
		handleSubmit,
		control,
		formState: { errors, isSubmitting },
	} = useForm<PersonalInfoFormData>({
		resolver: typeboxResolver(compiledSchema),
	});

	const onSubmit: SubmitHandler<PersonalInfoFormData> = async (data) => {
		setApiError("");
		try {
			await mutation.mutateAsync(data);
			void navigate({ to: "/onboarding/document" });
		} catch (err) {
			setApiError(
				err instanceof Error ? err.message : "Errore durante il salvataggio",
			);
		}
	};

	return (
		<OnboardingLayout
			currentStatus="pending_personal"
			title="Dati anagrafici"
			description="Inserisci le tue informazioni personali"
		>
			<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
				{apiError && (
					<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{apiError}
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

				<div className="grid grid-cols-2 gap-4">
					<Field data-invalid={!!errors.citizenship}>
						<FieldLabel>Cittadinanza</FieldLabel>
						<Controller
							control={control}
							name="citizenship"
							render={({ field }) => (
								<Select value={field.value} onValueChange={field.onChange}>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Seleziona" />
									</SelectTrigger>
									<SelectContent>
										{countries.map((c) => (
											<SelectItem key={c.code} value={c.code}>
												{c.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						/>
						<FieldError errors={[errors.citizenship]} />
					</Field>

					<Field data-invalid={!!errors.birthCountry}>
						<FieldLabel>Paese di nascita</FieldLabel>
						<Controller
							control={control}
							name="birthCountry"
							render={({ field }) => (
								<Select value={field.value} onValueChange={field.onChange}>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Seleziona" />
									</SelectTrigger>
									<SelectContent>
										{countries.map((c) => (
											<SelectItem key={c.code} value={c.code}>
												{c.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						/>
						<FieldError errors={[errors.birthCountry]} />
					</Field>
				</div>

				<Field data-invalid={!!errors.birthDate}>
					<FieldLabel htmlFor="birthDate">Data di nascita</FieldLabel>
					<Input id="birthDate" type="date" {...register("birthDate")} />
					<FieldError errors={[errors.birthDate]} />
				</Field>

				<Field data-invalid={!!errors.residenceCountry}>
					<FieldLabel>Paese di residenza</FieldLabel>
					<Controller
						control={control}
						name="residenceCountry"
						render={({ field }) => (
							<Select value={field.value} onValueChange={field.onChange}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Seleziona" />
								</SelectTrigger>
								<SelectContent>
									{countries.map((c) => (
										<SelectItem key={c.code} value={c.code}>
											{c.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					/>
					<FieldError errors={[errors.residenceCountry]} />
				</Field>

				<Field data-invalid={!!errors.residenceAddress}>
					<FieldLabel htmlFor="residenceAddress">
						Indirizzo di residenza
					</FieldLabel>
					<Input
						id="residenceAddress"
						placeholder="Via Roma 1"
						{...register("residenceAddress")}
					/>
					<FieldError errors={[errors.residenceAddress]} />
				</Field>

				<div className="grid grid-cols-2 gap-4">
					<Field data-invalid={!!errors.residenceCity}>
						<FieldLabel htmlFor="residenceCity">Città</FieldLabel>
						<Input
							id="residenceCity"
							placeholder="Roma"
							{...register("residenceCity")}
						/>
						<FieldError errors={[errors.residenceCity]} />
					</Field>

					<Field data-invalid={!!errors.residenceZipCode}>
						<FieldLabel htmlFor="residenceZipCode">CAP</FieldLabel>
						<Input
							id="residenceZipCode"
							placeholder="00100"
							maxLength={5}
							{...register("residenceZipCode")}
						/>
						<FieldError errors={[errors.residenceZipCode]} />
					</Field>
				</div>

				<Button type="submit" disabled={isSubmitting} className="w-full mt-2">
					{isSubmitting ? "Salvataggio..." : "Continua"}
				</Button>
			</form>
		</OnboardingLayout>
	);
}
