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
import { toast } from "@bibs/ui/components/sonner";
import { MunicipalityCombobox } from "@bibs/ui/custom/municipality-combobox";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";
import {
	municipalityComboboxLabels,
	useMunicipalities,
} from "@/hooks/use-municipalities";
import { useSellerSettings } from "@/hooks/use-seller-settings";
import { api, unwrap } from "@/lib/api";
import { zodResolver } from "@/lib/zod-resolver";
import { m } from "@/paraglide/messages";
import { VatChangeDialog } from "./vat-change-dialog";

export const businessInfoSchema = z.object({
	businessName: z
		.string()
		.min(1, { error: () => m.profile_business_name_required() }),
	legalForm: z
		.string()
		.min(1, { error: () => m.profile_business_legal_form_required() }),
	addressLine1: z
		.string()
		.min(1, { error: () => m.profile_business_address_required() }),
	zipCode: z
		.string()
		.regex(/^\d{5}$/, { error: () => m.profile_business_zip_invalid() }),
	municipalityId: z
		.string()
		.min(1, { error: () => m.profile_business_municipality_required() }),
	country: z.string().min(2).max(2),
});
type Form = z.infer<typeof businessInfoSchema>;

interface Props {
	readOnly: boolean;
}

export function BusinessInfoCard({ readOnly }: Props) {
	const { data, isLoading } = useSellerSettings();
	const org = data?.organization;
	const qc = useQueryClient();

	const {
		data: municipalities,
		isLoading: municipalitiesLoading,
		isError: municipalitiesError,
	} = useMunicipalities();

	const { register, handleSubmit, reset, control, formState } = useForm<Form>({
		resolver: zodResolver(businessInfoSchema),
	});

	useEffect(() => {
		if (org) {
			reset({
				businessName: org.businessName,
				legalForm: org.legalForm,
				addressLine1: org.addressLine1,
				zipCode: org.zipCode,
				municipalityId: org.municipalityId ?? "",
				country: org.country ?? "IT",
			});
		}
	}, [org, reset]);

	const mut = useMutation({
		mutationFn: async (form: Form) => {
			const r = await api().seller.settings.company.patch(form);
			return unwrap(r, m.profile_business_save_error());
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["seller", "settings"] });
			toast.success(m.profile_business_updated());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const onSubmit: SubmitHandler<Form> = (form) => mut.mutate(form);

	if (isLoading) return null;
	if (!org) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{m.profile_business_title()}</CardTitle>
				<CardDescription>
					{readOnly
						? m.profile_business_description_read_only()
						: m.profile_business_description()}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
					<Field data-invalid={!!formState.errors.businessName}>
						<FieldLabel htmlFor="businessName" required={!readOnly}>
							{m.common_business_name()}
						</FieldLabel>
						<Input
							id="businessName"
							disabled={readOnly}
							{...register("businessName")}
						/>
						<FieldError errors={[formState.errors.businessName]} />
					</Field>

					<Field data-invalid={!!formState.errors.legalForm}>
						<FieldLabel htmlFor="legalForm" required={!readOnly}>
							{m.common_legal_form()}
						</FieldLabel>
						<Input
							id="legalForm"
							disabled={readOnly}
							{...register("legalForm")}
						/>
						<FieldError errors={[formState.errors.legalForm]} />
					</Field>

					<Field>
						<FieldLabel htmlFor="vatNumber">{m.common_vat_number()}</FieldLabel>
						<div className="flex gap-2">
							<Input
								id="vatNumber"
								disabled
								value={org.vatNumber}
								className="flex-1"
							/>
							{!readOnly && <VatChangeDialog currentVat={org.vatNumber} />}
						</div>
					</Field>

					<Field data-invalid={!!formState.errors.addressLine1}>
						<FieldLabel htmlFor="addressLine1" required={!readOnly}>
							{m.profile_business_address()}
						</FieldLabel>
						<Input
							id="addressLine1"
							disabled={readOnly}
							{...register("addressLine1")}
						/>
						<FieldError errors={[formState.errors.addressLine1]} />
					</Field>

					<div className="grid grid-cols-2 gap-4">
						<Field data-invalid={!!formState.errors.zipCode}>
							<FieldLabel htmlFor="zipCode" required={!readOnly}>
								{m.common_zip()}
							</FieldLabel>
							<Input
								id="zipCode"
								disabled={readOnly}
								{...register("zipCode")}
							/>
							<FieldError errors={[formState.errors.zipCode]} />
						</Field>

						<Field data-invalid={!!formState.errors.municipalityId}>
							<FieldLabel htmlFor="municipalityId" required={!readOnly}>
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
										disabled={readOnly}
										aria-invalid={!!formState.errors.municipalityId}
									/>
								)}
							/>
							<FieldError errors={[formState.errors.municipalityId]} />
						</Field>
					</div>

					<Field data-invalid={!!formState.errors.country}>
						<FieldLabel htmlFor="country">
							{m.profile_business_country()}
						</FieldLabel>
						<Input id="country" disabled={readOnly} {...register("country")} />
						<FieldError errors={[formState.errors.country]} />
					</Field>

					{!readOnly && (
						<Button
							type="submit"
							disabled={!formState.isDirty || mut.isPending}
							className="mt-2"
						>
							{mut.isPending ? m.profile_saving() : m.common_save_changes()}
						</Button>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
