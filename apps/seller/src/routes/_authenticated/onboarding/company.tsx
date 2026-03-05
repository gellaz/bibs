import { CompanyBody } from "@bibs/api/schemas";
import { Button } from "@bibs/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import { useGoBack, useUpdateCompany } from "@/hooks/use-onboarding";

type CompanyFormData = Static<typeof CompanyBody>;
const compiledSchema = TypeCompiler.Compile(CompanyBody);

const LEGAL_FORMS = [
	"Ditta individuale",
	"SRL",
	"SRLS",
	"SAS",
	"SNC",
	"SPA",
	"Cooperativa",
	"Associazione",
	"Altro",
];

export const Route = createFileRoute("/_authenticated/onboarding/company")({
	component: CompanyPage,
});

function CompanyPage() {
	const navigate = useNavigate();
	const mutation = useUpdateCompany();
	const goBackMutation = useGoBack();
	const [apiError, setApiError] = useState("");

	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting },
	} = useForm<CompanyFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: { country: "IT" },
	});

	const onSubmit: SubmitHandler<CompanyFormData> = async (data) => {
		setApiError("");
		try {
			await mutation.mutateAsync(data);
			void navigate({ to: "/onboarding/store" });
		} catch (err) {
			setApiError(
				err instanceof Error ? err.message : "Errore durante il salvataggio",
			);
		}
	};

	return (
		<OnboardingLayout
			currentStatus="pending_company"
			title="Dati aziendali"
			description="Inserisci le informazioni della tua azienda"
		>
			<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
				{apiError && (
					<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{apiError}
					</div>
				)}

				<Field data-invalid={!!errors.businessName}>
					<FieldLabel htmlFor="businessName">Ragione sociale</FieldLabel>
					<Input
						id="businessName"
						placeholder="La Bottega di Mario SRL"
						autoFocus
						{...register("businessName")}
					/>
					<FieldError errors={[errors.businessName]} />
				</Field>

				<Field data-invalid={!!errors.vatNumber}>
					<FieldLabel htmlFor="vatNumber">Partita IVA</FieldLabel>
					<Input
						id="vatNumber"
						inputMode="numeric"
						placeholder="12345678901"
						maxLength={11}
						{...register("vatNumber")}
					/>
					<FieldDescription>
						11 cifre — sarà verificata da un amministratore
					</FieldDescription>
					<FieldError errors={[errors.vatNumber]} />
				</Field>

				<Field data-invalid={!!errors.legalForm}>
					<FieldLabel htmlFor="legalForm">Forma giuridica</FieldLabel>
					<NativeSelect className="w-full" {...register("legalForm")}>
						<NativeSelectOption value="">Seleziona...</NativeSelectOption>
						{LEGAL_FORMS.map((form) => (
							<NativeSelectOption key={form} value={form}>
								{form}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<FieldError errors={[errors.legalForm]} />
				</Field>

				<Field data-invalid={!!errors.addressLine1}>
					<FieldLabel htmlFor="addressLine1">Indirizzo sede legale</FieldLabel>
					<Input
						id="addressLine1"
						placeholder="Via Roma 1"
						{...register("addressLine1")}
					/>
					<FieldError errors={[errors.addressLine1]} />
				</Field>

				<div className="grid grid-cols-2 gap-4">
					<Field data-invalid={!!errors.city}>
						<FieldLabel htmlFor="city">Città</FieldLabel>
						<Input id="city" placeholder="Roma" {...register("city")} />
						<FieldError errors={[errors.city]} />
					</Field>

					<Field data-invalid={!!errors.province}>
						<FieldLabel htmlFor="province">Provincia</FieldLabel>
						<Input
							id="province"
							placeholder="RM"
							maxLength={2}
							{...register("province")}
						/>
						<FieldError errors={[errors.province]} />
					</Field>
				</div>

				<Field data-invalid={!!errors.zipCode}>
					<FieldLabel htmlFor="zipCode">CAP</FieldLabel>
					<Input
						id="zipCode"
						placeholder="00100"
						maxLength={5}
						{...register("zipCode")}
					/>
					<FieldError errors={[errors.zipCode]} />
				</Field>

				<Button
					type="submit"
					disabled={isSubmitting || goBackMutation.isPending}
					className="w-full mt-2"
				>
					{isSubmitting ? "Salvataggio..." : "Continua"}
				</Button>

				<Button
					type="button"
					variant="outline"
					disabled={isSubmitting || goBackMutation.isPending}
					className="w-full"
					onClick={async () => {
						try {
							await goBackMutation.mutateAsync(undefined);
							void navigate({ to: "/onboarding/document" });
						} catch (err) {
							setApiError(err instanceof Error ? err.message : "Errore");
						}
					}}
				>
					{goBackMutation.isPending ? "Attendere..." : "Indietro"}
				</Button>
			</form>
		</OnboardingLayout>
	);
}
