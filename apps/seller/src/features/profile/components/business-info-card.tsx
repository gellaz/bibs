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
import { MunicipalityCombobox } from "@bibs/ui/components/municipality-combobox";
import { toast } from "@bibs/ui/components/sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod";
import { useMunicipalities } from "@/hooks/use-municipalities";
import { useSellerSettings } from "@/hooks/use-seller-settings";
import { api, unwrap } from "@/lib/api";
import { VatChangeDialog } from "./vat-change-dialog";

const schema = z.object({
	businessName: z.string().min(1, "Ragione sociale obbligatoria"),
	legalForm: z.string().min(1, "Forma giuridica obbligatoria"),
	addressLine1: z.string().min(1, "Indirizzo obbligatorio"),
	zipCode: z.string().regex(/^\d{5}$/, "CAP deve essere 5 cifre"),
	municipalityId: z.string().min(1, "Comune obbligatorio"),
	country: z.string().min(2).max(2),
});
type Form = z.infer<typeof schema>;

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
		resolver: zodResolver(schema),
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
			return unwrap(r, "Errore nel salvataggio");
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["seller", "settings"] });
			toast.success("Informazioni aziendali aggiornate");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const onSubmit: SubmitHandler<Form> = (form) => mut.mutate(form);

	if (isLoading) return null;
	if (!org) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Informazioni aziendali</CardTitle>
				<CardDescription>
					Dati dell'azienda registrata{readOnly ? " (sola lettura)" : ""}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
					<Field data-invalid={!!formState.errors.businessName}>
						<FieldLabel htmlFor="businessName" required={!readOnly}>
							Ragione sociale
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
							Forma giuridica
						</FieldLabel>
						<Input
							id="legalForm"
							disabled={readOnly}
							{...register("legalForm")}
						/>
						<FieldError errors={[formState.errors.legalForm]} />
					</Field>

					<Field>
						<FieldLabel htmlFor="vatNumber">Partita IVA</FieldLabel>
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
							Indirizzo sede
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
								CAP
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
								Comune
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
										disabled={readOnly}
										aria-invalid={!!formState.errors.municipalityId}
									/>
								)}
							/>
							<FieldError errors={[formState.errors.municipalityId]} />
						</Field>
					</div>

					<Field>
						<FieldLabel htmlFor="country">Paese</FieldLabel>
						<Input id="country" disabled={readOnly} {...register("country")} />
					</Field>

					{!readOnly && (
						<Button
							type="submit"
							disabled={!formState.isDirty || mut.isPending}
							className="mt-2"
						>
							{mut.isPending ? "Salvataggio..." : "Salva modifiche"}
						</Button>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
