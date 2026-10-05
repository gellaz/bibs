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
import { MunicipalityCombobox } from "@bibs/ui/custom/municipality-combobox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import { useCountries } from "@/hooks/use-countries";
import {
	municipalitiesQueryOptions,
	municipalityComboboxLabels,
	useMunicipalities,
} from "@/hooks/use-municipalities";
import { useUpdatePersonalInfo } from "@/hooks/use-onboarding";
import { typeboxResolver } from "@/lib/typebox-resolver";
import { m } from "@/paraglide/messages";

type PersonalInfoFormData = Static<typeof PersonalInfoBody>;
const compiledSchema = TypeCompiler.Compile(PersonalInfoBody);

export const Route = createFileRoute(
	"/_authenticated/onboarding/personal-info",
)({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(municipalitiesQueryOptions()),
	component: PersonalInfoPage,
});

function PersonalInfoPage() {
	const navigate = useNavigate();
	const mutation = useUpdatePersonalInfo();
	const { data: countries = [] } = useCountries();
	const {
		data: municipalities,
		isLoading: municipalitiesLoading,
		isError: municipalitiesError,
	} = useMunicipalities();
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
				err instanceof Error ? err.message : m.onboarding_save_error(),
			);
		}
	};

	return (
		<OnboardingLayout
			currentStatus="pending_personal"
			title={m.onboarding_personal_title()}
			description={m.onboarding_personal_description()}
		>
			<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
				{apiError && (
					<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{apiError}
					</div>
				)}

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Field data-invalid={!!errors.firstName}>
						<FieldLabel htmlFor="firstName">{m.common_first_name()}</FieldLabel>
						<Input
							id="firstName"
							placeholder="Mario"
							autoFocus
							{...register("firstName")}
						/>
						<FieldError errors={[errors.firstName]} />
					</Field>

					<Field data-invalid={!!errors.lastName}>
						<FieldLabel htmlFor="lastName">{m.common_last_name()}</FieldLabel>
						<Input
							id="lastName"
							placeholder="Rossi"
							{...register("lastName")}
						/>
						<FieldError errors={[errors.lastName]} />
					</Field>
				</div>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Field data-invalid={!!errors.citizenship}>
						<FieldLabel>{m.onboarding_personal_citizenship()}</FieldLabel>
						<Controller
							control={control}
							name="citizenship"
							render={({ field }) => (
								<Select value={field.value} onValueChange={field.onChange}>
									<SelectTrigger className="w-full">
										<SelectValue
											placeholder={m.onboarding_select_placeholder()}
										/>
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
						<FieldLabel>{m.onboarding_personal_birth_country()}</FieldLabel>
						<Controller
							control={control}
							name="birthCountry"
							render={({ field }) => (
								<Select value={field.value} onValueChange={field.onChange}>
									<SelectTrigger className="w-full">
										<SelectValue
											placeholder={m.onboarding_select_placeholder()}
										/>
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
					<FieldLabel htmlFor="birthDate">{m.common_birth_date()}</FieldLabel>
					<Input id="birthDate" type="date" {...register("birthDate")} />
					<FieldError errors={[errors.birthDate]} />
				</Field>

				<Field data-invalid={!!errors.residenceCountry}>
					<FieldLabel>{m.onboarding_personal_residence_country()}</FieldLabel>
					<Controller
						control={control}
						name="residenceCountry"
						render={({ field }) => (
							<Select value={field.value} onValueChange={field.onChange}>
								<SelectTrigger className="w-full">
									<SelectValue
										placeholder={m.onboarding_select_placeholder()}
									/>
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
						{m.onboarding_personal_residence_address()}
					</FieldLabel>
					<Input
						id="residenceAddress"
						placeholder="Via Roma 1"
						{...register("residenceAddress")}
					/>
					<FieldError errors={[errors.residenceAddress]} />
				</Field>

				<Field data-invalid={!!errors.residenceMunicipalityId}>
					<FieldLabel htmlFor="residenceMunicipalityId">
						{m.onboarding_personal_residence_municipality()}
					</FieldLabel>
					<Controller
						control={control}
						name="residenceMunicipalityId"
						render={({ field }) => (
							<MunicipalityCombobox
								id="residenceMunicipalityId"
								value={field.value ?? null}
								onChange={field.onChange}
								municipalities={municipalities}
								loading={municipalitiesLoading}
								error={municipalitiesError}
								labels={municipalityComboboxLabels()}
								aria-invalid={!!errors.residenceMunicipalityId}
							/>
						)}
					/>
					<FieldError errors={[errors.residenceMunicipalityId]} />
				</Field>

				<Field data-invalid={!!errors.residenceZipCode}>
					<FieldLabel htmlFor="residenceZipCode">{m.common_zip()}</FieldLabel>
					<Input
						id="residenceZipCode"
						placeholder="00100"
						maxLength={5}
						{...register("residenceZipCode")}
					/>
					<FieldError errors={[errors.residenceZipCode]} />
				</Field>

				<Button type="submit" disabled={isSubmitting} className="w-full mt-2">
					{isSubmitting ? m.onboarding_saving() : m.onboarding_continue()}
				</Button>
			</form>
		</OnboardingLayout>
	);
}
