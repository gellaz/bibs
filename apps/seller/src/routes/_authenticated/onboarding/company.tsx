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
import { MunicipalityCombobox } from "@bibs/ui/custom/municipality-combobox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import { LEGAL_FORMS } from "@/features/onboarding/legal-forms";
import {
	municipalitiesQueryOptions,
	municipalityComboboxLabels,
	useMunicipalities,
} from "@/hooks/use-municipalities";
import { useGoBack, useUpdateCompany } from "@/hooks/use-onboarding";
import { typeboxResolver } from "@/lib/typebox-resolver";
import { m } from "@/paraglide/messages";

type CompanyFormData = Static<typeof CompanyBody>;
const compiledSchema = TypeCompiler.Compile(CompanyBody);

export const Route = createFileRoute("/_authenticated/onboarding/company")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(municipalitiesQueryOptions()),
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
		control,
		formState: { errors, isSubmitting },
	} = useForm<CompanyFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: { country: "IT" },
	});

	const {
		data: municipalities,
		isLoading: municipalitiesLoading,
		isError: municipalitiesError,
	} = useMunicipalities();

	const onSubmit: SubmitHandler<CompanyFormData> = async (data) => {
		setApiError("");
		try {
			await mutation.mutateAsync(data);
			void navigate({ to: "/onboarding/pending" });
		} catch (err) {
			setApiError(
				err instanceof Error ? err.message : m.onboarding_save_error(),
			);
		}
	};

	return (
		<OnboardingLayout
			currentStatus="pending_company"
			title={m.onboarding_company_title()}
			description={m.onboarding_company_description()}
		>
			<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
				{apiError && (
					<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{apiError}
					</div>
				)}

				<Field data-invalid={!!errors.businessName}>
					<FieldLabel htmlFor="businessName">
						{m.common_business_name()}
					</FieldLabel>
					<Input
						id="businessName"
						placeholder="La Bottega di Mario SRL"
						autoFocus
						{...register("businessName")}
					/>
					<FieldError errors={[errors.businessName]} />
				</Field>

				<Field data-invalid={!!errors.vatNumber}>
					<FieldLabel htmlFor="vatNumber">{m.common_vat_number()}</FieldLabel>
					<Input
						id="vatNumber"
						inputMode="numeric"
						placeholder="12345678901"
						maxLength={11}
						{...register("vatNumber")}
					/>
					<FieldDescription>{m.onboarding_company_vat_hint()}</FieldDescription>
					<FieldError errors={[errors.vatNumber]} />
				</Field>

				<Field data-invalid={!!errors.legalForm}>
					<FieldLabel htmlFor="legalForm">{m.common_legal_form()}</FieldLabel>
					<NativeSelect className="w-full" {...register("legalForm")}>
						<NativeSelectOption value="">
							{m.onboarding_company_legal_form_placeholder()}
						</NativeSelectOption>
						{LEGAL_FORMS.map((form) => (
							<NativeSelectOption key={form.value} value={form.value}>
								{form.label()}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<FieldError errors={[errors.legalForm]} />
				</Field>

				<Field data-invalid={!!errors.addressLine1}>
					<FieldLabel htmlFor="addressLine1">
						{m.onboarding_company_address()}
					</FieldLabel>
					<Input
						id="addressLine1"
						placeholder="Via Roma 1"
						{...register("addressLine1")}
					/>
					<FieldError errors={[errors.addressLine1]} />
				</Field>

				<Field data-invalid={!!errors.municipalityId}>
					<FieldLabel htmlFor="municipalityId">
						{m.common_municipality()}
					</FieldLabel>
					<Controller
						control={control}
						name="municipalityId"
						render={({ field }) => (
							<MunicipalityCombobox
								id="municipalityId"
								value={field.value ?? null}
								onChange={field.onChange}
								municipalities={municipalities}
								loading={municipalitiesLoading}
								error={municipalitiesError}
								labels={municipalityComboboxLabels()}
								aria-invalid={!!errors.municipalityId}
							/>
						)}
					/>
					<FieldError errors={[errors.municipalityId]} />
				</Field>

				<Field data-invalid={!!errors.zipCode}>
					<FieldLabel htmlFor="zipCode">{m.common_zip()}</FieldLabel>
					<Input
						id="zipCode"
						placeholder="00100"
						maxLength={5}
						{...register("zipCode")}
					/>
					<FieldError errors={[errors.zipCode]} />
				</Field>

				<div className="mt-2 flex flex-col gap-2 sm:flex-row-reverse">
					<Button
						type="submit"
						disabled={isSubmitting || goBackMutation.isPending}
						className="flex-1"
					>
						{isSubmitting ? m.onboarding_saving() : m.onboarding_continue()}
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={isSubmitting || goBackMutation.isPending}
						className="flex-1"
						onClick={async () => {
							try {
								await goBackMutation.mutateAsync(undefined);
								void navigate({ to: "/onboarding/document" });
							} catch (err) {
								setApiError(
									err instanceof Error ? err.message : m.common_error(),
								);
							}
						}}
					>
						{goBackMutation.isPending
							? m.onboarding_waiting()
							: m.common_back()}
					</Button>
				</div>
			</form>
		</OnboardingLayout>
	);
}
