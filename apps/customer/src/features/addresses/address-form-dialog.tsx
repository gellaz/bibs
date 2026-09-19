import { Button } from "@bibs/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@bibs/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { MunicipalityCombobox } from "@bibs/ui/components/municipality-combobox";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { Switch } from "@bibs/ui/components/switch";
import { lazy, Suspense, useEffect, useId, useState } from "react";
import { m } from "@/paraglide/messages";
import type {
	AddressFormErrors,
	AddressFormValues,
} from "./address-form-state";
import {
	addressFormToBody,
	addressToAddressForm,
	emptyAddressForm,
	isAddressFormValid,
	suggestionToAddressForm,
	validateAddressForm,
} from "./address-form-state";
import { AddressSearch } from "./address-search";
import { useAddressMutations } from "./use-address-mutations";
import type { AddressItem } from "./use-addresses";
import { useMunicipalities } from "./use-municipalities";

// Leaflet è DOM-only: si carica a parte e si monta solo dopo l'hydration.
const LazyAddressMapPreview = lazy(() => import("./address-map-preview"));

const LABEL_PRESETS = ["label_home", "label_work", "label_other"] as const;

function errorText(code: AddressFormErrors[keyof AddressFormErrors]) {
	if (code === "format") return m.address_form_error_zip();
	return m.address_form_error_required();
}

interface AddressFormDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Assente = creazione; presente = modifica di quell'indirizzo. */
	address?: AddressItem;
}

export function AddressFormDialog({
	open,
	onOpenChange,
	address,
}: AddressFormDialogProps) {
	const ids = useId();
	const [values, setValues] = useState<AddressFormValues>(emptyAddressForm());
	const [touched, setTouched] = useState(false);
	const municipalities = useMunicipalities();
	const { create, update } = useAddressMutations();

	// Il dialog si rimonta a ogni apertura, quindi i valori si sincronizzano
	// sull'indirizzo in modifica senza il `reset(defaultValues)` di RHF che
	// desincronizza i Select.
	useEffect(() => {
		if (!open) return;
		setValues(address ? addressToAddressForm(address) : emptyAddressForm());
		setTouched(false);
	}, [open, address]);

	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);

	const errors = validateAddressForm(values);
	const showErrors = touched;
	const isSubmitting = create.isPending || update.isPending;
	// Un indirizzo è stato scelto (o il pin spostato) ma il comune non si è
	// risolto: è lì che va chiesta conferma. Su un form ancora vuoto no.
	const municipalityNeedsConfirm =
		!values.municipalityId && values.location !== null;

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setTouched(true);
		if (!isAddressFormValid(errors)) return;

		const body = addressFormToBody(values);
		const done = { onSuccess: () => onOpenChange(false) };
		if (address) update.mutate({ addressId: address.id, body }, done);
		else create.mutate(body, done);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{address
							? m.address_form_edit_title()
							: m.address_form_create_title()}
					</DialogTitle>
					<DialogDescription>{m.address_form_description()}</DialogDescription>
				</DialogHeader>

				<form className="space-y-5" onSubmit={handleSubmit}>
					<AddressSearch
						disabled={isSubmitting}
						onSelect={(suggestion) =>
							setValues((previous) =>
								suggestionToAddressForm(suggestion, previous),
							)
						}
					/>

					{values.location && (
						<div className="space-y-1.5">
							{hydrated ? (
								<Suspense
									fallback={<Skeleton className="h-48 w-full sm:h-56" />}
								>
									<LazyAddressMapPreview
										location={values.location}
										onMove={(location) =>
											setValues((previous) => ({ ...previous, location }))
										}
									/>
								</Suspense>
							) : (
								<Skeleton className="h-48 w-full sm:h-56" />
							)}
							<p className="text-muted-foreground text-xs">
								{m.address_map_hint()}
							</p>
						</div>
					)}

					<Field data-invalid={showErrors && !!errors.addressLine1}>
						<FieldLabel htmlFor={`${ids}-line1`}>
							{m.address_form_line1()}
						</FieldLabel>
						<Input
							id={`${ids}-line1`}
							value={values.addressLine1}
							onChange={(e) =>
								setValues((v) => ({ ...v, addressLine1: e.target.value }))
							}
							aria-invalid={showErrors && !!errors.addressLine1}
							aria-describedby={
								showErrors && errors.addressLine1
									? `${ids}-line1-error`
									: undefined
							}
						/>
						{showErrors && errors.addressLine1 && (
							<FieldError id={`${ids}-line1-error`}>
								{errorText(errors.addressLine1)}
							</FieldError>
						)}
					</Field>

					<Field>
						<FieldLabel htmlFor={`${ids}-line2`}>
							{m.address_form_line2()}
						</FieldLabel>
						<Input
							id={`${ids}-line2`}
							value={values.addressLine2}
							onChange={(e) =>
								setValues((v) => ({ ...v, addressLine2: e.target.value }))
							}
						/>
					</Field>

					<div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
						<Field data-invalid={showErrors && !!errors.zipCode}>
							<FieldLabel htmlFor={`${ids}-zip`}>
								{m.address_form_zip()}
							</FieldLabel>
							<Input
								id={`${ids}-zip`}
								inputMode="numeric"
								maxLength={5}
								value={values.zipCode}
								onChange={(e) =>
									setValues((v) => ({ ...v, zipCode: e.target.value }))
								}
								aria-invalid={showErrors && !!errors.zipCode}
								aria-describedby={
									showErrors && errors.zipCode ? `${ids}-zip-error` : undefined
								}
							/>
							{showErrors && errors.zipCode && (
								<FieldError id={`${ids}-zip-error`}>
									{errorText(errors.zipCode)}
								</FieldError>
							)}
						</Field>

						<Field data-invalid={showErrors && !!errors.municipalityId}>
							<FieldLabel htmlFor={`${ids}-municipality`}>
								{municipalityNeedsConfirm
									? m.address_form_municipality_confirm()
									: m.address_form_municipality()}
							</FieldLabel>
							<MunicipalityCombobox
								id={`${ids}-municipality`}
								value={values.municipalityId}
								onChange={(id) =>
									setValues((v) => ({ ...v, municipalityId: id }))
								}
								municipalities={municipalities.data}
								loading={municipalities.isPending}
								error={municipalities.isError}
								aria-invalid={showErrors && !!errors.municipalityId}
								aria-describedby={
									showErrors && errors.municipalityId
										? `${ids}-municipality-error`
										: undefined
								}
							/>
							{values.municipalityCandidates.length > 1 && (
								<p className="text-muted-foreground text-xs">
									{m.address_form_municipality_ambiguous()}
								</p>
							)}
							{showErrors && errors.municipalityId && (
								<FieldError id={`${ids}-municipality-error`}>
									{errorText(errors.municipalityId)}
								</FieldError>
							)}
						</Field>
					</div>

					{showErrors && errors.location && (
						<p className="text-destructive text-sm">
							{m.address_form_error_location()}
						</p>
					)}

					<Field>
						<FieldLabel htmlFor={`${ids}-label`}>
							{m.address_form_label()}
						</FieldLabel>
						<Input
							id={`${ids}-label`}
							placeholder={m.address_form_label_placeholder()}
							maxLength={50}
							value={values.label}
							onChange={(e) =>
								setValues((v) => ({ ...v, label: e.target.value }))
							}
						/>
						<div className="mt-1 flex flex-wrap gap-2">
							{LABEL_PRESETS.map((preset) => {
								const text =
									preset === "label_home"
										? m.address_form_label_home()
										: preset === "label_work"
											? m.address_form_label_work()
											: m.address_form_label_other();
								return (
									<Button
										key={preset}
										type="button"
										variant="secondary"
										size="sm"
										className="min-h-11 sm:min-h-8"
										onClick={() => setValues((v) => ({ ...v, label: text }))}
									>
										{text}
									</Button>
								);
							})}
						</div>
					</Field>

					<div className="grid gap-4 sm:grid-cols-2">
						<Field>
							<FieldLabel htmlFor={`${ids}-recipient`}>
								{m.address_form_recipient()}
							</FieldLabel>
							<Input
								id={`${ids}-recipient`}
								maxLength={100}
								value={values.recipientName}
								onChange={(e) =>
									setValues((v) => ({ ...v, recipientName: e.target.value }))
								}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${ids}-phone`}>
								{m.address_form_phone()}
							</FieldLabel>
							<Input
								id={`${ids}-phone`}
								type="tel"
								maxLength={30}
								value={values.phone}
								onChange={(e) =>
									setValues((v) => ({ ...v, phone: e.target.value }))
								}
							/>
						</Field>
					</div>
					<p className="text-muted-foreground text-xs">
						{m.address_form_delivery_note()}
					</p>

					<div className="flex items-center gap-3">
						<Switch
							id={`${ids}-default`}
							checked={values.isDefault}
							onCheckedChange={(checked) =>
								setValues((v) => ({ ...v, isDefault: checked }))
							}
						/>
						<FieldLabel htmlFor={`${ids}-default`}>
							{m.address_form_default()}
						</FieldLabel>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="secondary"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							{m.address_form_cancel()}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{m.address_form_save()}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
