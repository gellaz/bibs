import { CreateStoreBody } from "@bibs/api/schemas";
import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { Separator } from "@bibs/ui/components/separator";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { Textarea } from "@bibs/ui/components/textarea";
import { MunicipalityCombobox } from "@bibs/ui/custom/municipality-combobox";
import { cn } from "@bibs/ui/lib/utils";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import "@/lib/typebox-formats";
import { useQueryClient } from "@tanstack/react-query";
import { LocateFixed, MapPinOff, PlusIcon, Trash2Icon } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
	Controller,
	type SubmitHandler,
	useFieldArray,
	useForm,
} from "react-hook-form";
import { FormSection } from "@/components/form-section";
import {
	municipalityComboboxLabels,
	useMunicipalities,
} from "@/hooks/use-municipalities";
import { m } from "@/paraglide/messages";
import {
	fetchGeocodeSuggestions,
	type GeocodeSuggestionItem,
	geocodeQueryKey,
} from "../hooks/use-geocode";
import { validateOpeningHours } from "../lib/validate-opening-hours";
import {
	type DaySchedule,
	DEFAULT_OPENING_HOURS,
	OpeningHoursEditor,
} from "./opening-hours-editor";
import { StoreAddressSearch } from "./store-address-search";

// Leaflet è DOM-only: si carica a parte e si monta solo dopo l'hydration.
const LazyStoreMapPreview = lazy(() => import("./store-map-preview"));

export type StoreFormData = Static<typeof CreateStoreBody>;
const compiledSchema = TypeCompiler.Compile(CreateStoreBody);

/**
 * Canonical serialization of opening hours for change detection. Days are
 * sorted and slot keys normalized so toggling a day on/off or differing key
 * order can't produce a false "dirty" reading.
 */
function serializeOpeningHours(hours: DaySchedule[]): string {
	return JSON.stringify(
		[...hours]
			.sort((a, b) => a.dayOfWeek - b.dayOfWeek)
			.map((d) => ({
				dayOfWeek: d.dayOfWeek,
				slots: d.slots.map((s) => ({ open: s.open, close: s.close })),
			})),
	);
}

interface StoreFormProps {
	onSubmit: (data: StoreFormData) => void;
	/** Se assente, il bottone Annulla non viene mostrato (primo negozio). */
	onCancel?: () => void;
	isPending: boolean;
	defaultValues?: Partial<StoreFormData>;
	submitLabel?: string;
	pendingLabel?: string;
	onNameChange?: (name: string) => void;
	readOnly?: boolean;
	lastSavedAt?: number;
}

export function StoreForm({
	onSubmit,
	onCancel,
	isPending,
	defaultValues,
	submitLabel = m.store_form_create(),
	pendingLabel = m.store_form_creating(),
	onNameChange,
	readOnly = false,
	lastSavedAt,
}: StoreFormProps) {
	// openingHours is kept outside react-hook-form, so RHF's isDirty does not
	// react to changes here. Snapshot the value at mount and diff against it so
	// opening-hours-only edits can still enable Save (see store form audit).
	const [initialOpeningHours, setInitialOpeningHours] = useState<DaySchedule[]>(
		() =>
			(defaultValues?.openingHours as DaySchedule[] | undefined) ??
			DEFAULT_OPENING_HOURS.map((d) => ({
				...d,
				slots: d.slots.map((s) => ({ ...s })),
			})),
	);
	const [openingHours, setOpeningHours] =
		useState<DaySchedule[]>(initialOpeningHours);

	const {
		register,
		handleSubmit,
		control,
		watch,
		reset,
		getValues,
		setValue,
		formState: { errors, isDirty, isSubmitted },
	} = useForm<StoreFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: {
			name: "",
			description: "",
			addressLine1: "",
			addressLine2: "",
			municipalityId: "",
			zipCode: "",
			// undefined (non ""): lo schema è Optional + format uri, quindi ""
			// presente NON valida; e il default deve combaciare col setValueAs
			// (""→undefined) per non generare phantom isDirty.
			websiteUrl: undefined,
			phoneNumbers: [],
			...defaultValues,
		},
	});

	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);

	const location = watch("location");
	const setLocation = (next: { x: number; y: number }) =>
		setValue("location", next, {
			shouldDirty: true,
			shouldValidate: isSubmitted,
		});

	const applySuggestion = (suggestion: GeocodeSuggestionItem) => {
		const opts = { shouldDirty: true, shouldValidate: isSubmitted };
		setValue("addressLine1", suggestion.addressLine1, opts);
		if (suggestion.zipCode) setValue("zipCode", suggestion.zipCode, opts);
		// Comune non risolto (omonimi o fuori elenco): lo sceglie il seller.
		setValue("municipalityId", suggestion.municipality?.id ?? "", opts);
		setLocation(suggestion.location);
	};

	// Per i negozi nati senza pin: prova a posizionarlo dall'indirizzo già
	// salvato, così il seller deve solo verificarlo sulla mappa.
	const queryClient = useQueryClient();
	const [locating, setLocating] = useState(false);
	const [locateMiss, setLocateMiss] = useState(false);
	const locateFromAddress = async () => {
		const { addressLine1, municipalityId } = getValues();
		const municipality = municipalities?.find((mu) => mu.id === municipalityId);
		const q = [addressLine1, municipality?.name].filter(Boolean).join(", ");
		setLocating(true);
		setLocateMiss(false);
		try {
			const hits = await queryClient.fetchQuery({
				queryKey: geocodeQueryKey(q),
				queryFn: () => fetchGeocodeSuggestions(q),
				staleTime: 5 * 60_000,
			});
			const hit =
				hits.find((h) => h.municipality?.id === municipalityId) ?? hits[0];
			if (hit) setLocation(hit.location);
			else setLocateMiss(true);
		} catch {
			setLocateMiss(true);
		} finally {
			setLocating(false);
		}
	};

	const nameValue = watch("name");
	useEffect(() => {
		onNameChange?.(nameValue);
	}, [nameValue, onNameChange]);

	const openingHoursDirty =
		serializeOpeningHours(openingHours) !==
		serializeOpeningHours(initialOpeningHours);
	const hasChanges = isDirty || openingHoursDirty;
	const hasDeclaredHours = openingHours.some((d) => d.slots.length > 0);

	const hoursErrors = useMemo(
		() => validateOpeningHours(openingHours),
		[openingHours],
	);
	const hoursInvalid = Object.keys(hoursErrors).length > 0;

	// Re-baseline dopo un save riuscito: i valori correnti diventano i nuovi
	// default (isDirty→false) e lo snapshot orari viene riallineato, così il
	// bottone Salva si disabilita finché non c'è una nuova modifica.
	// Intentionally depends ONLY on lastSavedAt: adding openingHours would
	// re-baseline on every edit and kill dirty-detection entirely.
	useEffect(() => {
		if (!lastSavedAt) return;
		reset(getValues());
		setInitialOpeningHours(
			openingHours.map((d) => ({
				...d,
				slots: d.slots.map((s) => ({ ...s })),
			})),
		);
	}, [lastSavedAt]);

	const { fields, append, remove } = useFieldArray({
		control,
		name: "phoneNumbers",
	});

	const {
		data: municipalities,
		isLoading: municipalitiesLoading,
		isError: municipalitiesError,
	} = useMunicipalities();

	const onFormSubmit: SubmitHandler<StoreFormData> = (data) => {
		if (hoursInvalid) return;
		const cleaned: StoreFormData = {
			...data,
			description: data.description || undefined,
			addressLine2: data.addressLine2 || undefined,
			// null (non undefined): Eden non serializza undefined e il clear del
			// sito non arriverebbe mai al server — stessa classe di bug degli orari.
			websiteUrl: data.websiteUrl || null,
			// [] (tutti i giorni chiusi) deve viaggiare come null: Eden non
			// serializza undefined e il PATCH non vedrebbe mai il clear.
			openingHours: openingHours.length > 0 ? openingHours : null,
			phoneNumbers:
				data.phoneNumbers && data.phoneNumbers.length > 0
					? data.phoneNumbers.map((p, idx) => ({
							label: p.label || undefined,
							number: p.number,
							position: idx,
						}))
					: undefined,
		};
		onSubmit(cleaned);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)} className="space-y-10">
			<FormSection
				title={m.store_form_identity_title()}
				description={m.store_form_identity_description()}
			>
				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="store-name" required>
						{m.common_name()}
					</FieldLabel>
					<Input
						id="store-name"
						placeholder={m.store_form_name_placeholder()}
						autoFocus
						disabled={readOnly}
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>

				<Field>
					<FieldLabel htmlFor="store-description">
						{m.store_form_description()}
					</FieldLabel>
					<Textarea
						id="store-description"
						placeholder={m.store_form_description_placeholder()}
						rows={2}
						disabled={readOnly}
						{...register("description")}
					/>
				</Field>
			</FormSection>

			<Separator />

			<FormSection
				title={m.store_address()}
				description={m.store_form_address_description()}
			>
				{!readOnly && (
					<StoreAddressSearch onSelect={applySuggestion} disabled={isPending} />
				)}

				{location ? (
					<div className="space-y-1.5">
						{hydrated ? (
							<Suspense fallback={<Skeleton className="h-56 w-full" />}>
								<LazyStoreMapPreview
									location={location}
									onMove={setLocation}
									readOnly={readOnly}
								/>
							</Suspense>
						) : (
							<Skeleton className="h-56 w-full" />
						)}
						{!readOnly && (
							<p className="text-muted-foreground text-xs">
								{m.store_form_map_hint()}
							</p>
						)}
					</div>
				) : (
					<div
						data-invalid={!!errors.location || undefined}
						className="flex flex-col gap-3 rounded-md border border-border bg-muted px-3 py-3 text-sm data-invalid:border-destructive/50 data-invalid:bg-destructive/5 sm:flex-row sm:items-center sm:justify-between"
					>
						<div className="flex items-start gap-2">
							<MapPinOff
								className="mt-0.5 size-4 shrink-0 text-muted-foreground"
								aria-hidden
							/>
							<p
								className="text-muted-foreground"
								role={errors.location ? "alert" : undefined}
							>
								{errors.location
									? m.store_form_location_required()
									: m.store_form_location_missing()}
								{locateMiss && ` ${m.store_form_locate_miss()}`}
							</p>
						</div>
						{!readOnly && defaultValues?.addressLine1 && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="shrink-0 self-start sm:self-auto"
								disabled={locating}
								onClick={locateFromAddress}
							>
								<LocateFixed className="size-4" aria-hidden />
								{locating ? m.store_form_locating() : m.store_form_locate()}
							</Button>
						)}
					</div>
				)}

				<Field data-invalid={!!errors.addressLine1}>
					<FieldLabel htmlFor="store-address1" required>
						{m.store_address()}
					</FieldLabel>
					<Input
						id="store-address1"
						placeholder={m.store_form_address_placeholder()}
						disabled={readOnly}
						{...register("addressLine1")}
					/>
					<FieldError errors={[errors.addressLine1]} />
				</Field>

				<Field>
					<FieldLabel htmlFor="store-address2">
						{m.store_form_address2()}
					</FieldLabel>
					<Input
						id="store-address2"
						placeholder={m.store_form_address2_placeholder()}
						disabled={readOnly}
						{...register("addressLine2")}
					/>
				</Field>

				<div className="grid grid-cols-[1fr_auto] gap-4">
					<Field data-invalid={!!errors.municipalityId}>
						<FieldLabel htmlFor="municipalityId" required>
							{m.store_form_municipality()}
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
					<Field data-invalid={!!errors.zipCode} className="w-32">
						<FieldLabel htmlFor="store-zip" required>
							{m.store_form_zip()}
						</FieldLabel>
						<Input
							id="store-zip"
							placeholder="20100"
							inputMode="numeric"
							maxLength={5}
							disabled={readOnly}
							{...register("zipCode")}
						/>
						<FieldError errors={[errors.zipCode]} />
					</Field>
				</div>
			</FormSection>

			<Separator />

			<FormSection
				title={m.store_hours_title()}
				description={m.store_form_hours_description()}
			>
				{!hasDeclaredHours && (
					<p className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground text-sm">
						{m.store_form_hours_missing()}
					</p>
				)}
				<OpeningHoursEditor
					value={openingHours}
					onChange={setOpeningHours}
					readOnly={readOnly}
					dayErrors={hoursErrors}
				/>
			</FormSection>

			<Separator />

			<FormSection
				title={m.store_form_contacts_title()}
				description={m.store_form_contacts_description()}
			>
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<Label>{m.store_form_phones()}</Label>
						{!readOnly && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => append({ label: "", number: "" })}
							>
								<PlusIcon className="size-3" />
								<span>{m.common_add()}</span>
							</Button>
						)}
					</div>
					{fields.length === 0 ? (
						<p className="text-sm text-muted-foreground italic">
							{m.store_form_phones_empty()}
						</p>
					) : (
						<div className="space-y-2">
							{fields.map((field, index) => (
								<div key={field.id} className="flex gap-2">
									<Input
										placeholder={m.store_form_phone_label_placeholder()}
										className="w-1/3"
										disabled={readOnly}
										{...register(`phoneNumbers.${index}.label`)}
									/>
									<Field
										data-invalid={!!errors.phoneNumbers?.[index]?.number}
										className="flex-1"
									>
										<Input
											placeholder={m.store_form_phone_number_placeholder()}
											type="tel"
											disabled={readOnly}
											{...register(`phoneNumbers.${index}.number`)}
										/>
										<FieldError
											errors={[errors.phoneNumbers?.[index]?.number]}
										/>
									</Field>
									{!readOnly && (
										<Button
											type="button"
											variant="ghost"
											size="icon"
											onClick={() => remove(index)}
										>
											<Trash2Icon className="size-4" />
										</Button>
									)}
								</div>
							))}
						</div>
					)}
				</div>

				<Field data-invalid={!!errors.websiteUrl}>
					<FieldLabel htmlFor="store-website">
						{m.store_form_website()}
					</FieldLabel>
					<Input
						id="store-website"
						type="url"
						placeholder={m.store_form_website_placeholder()}
						disabled={readOnly}
						{...register("websiteUrl", {
							// Load-bearing: ""→undefined fa passare la validazione
							// (Optional + format uri rifiuta "" presente) E allinea il
							// valore al default undefined (niente phantom isDirty).
							setValueAs: (v) => v || undefined,
						})}
					/>
					<FieldError errors={[errors.websiteUrl]} />
				</Field>
			</FormSection>

			{!readOnly && (
				<>
					<Separator />
					{/* Il form è lungo (orari, telefoni, indirizzo): con modifiche in
					    sospeso il salvataggio resta in vista in fondo allo schermo.
					    Senza modifiche torna al suo posto, a fine form. */}
					<div
						className={cn(
							"flex items-center justify-end gap-3",
							hasChanges &&
								"sticky bottom-0 z-10 -mx-4 border-border border-t bg-background px-4 py-3",
						)}
					>
						{hasChanges && (
							<p
								className="mr-auto text-muted-foreground text-sm"
								role="status"
							>
								{m.store_form_unsaved()}
							</p>
						)}
						{onCancel && (
							<Button type="button" variant="outline" onClick={onCancel}>
								{m.common_cancel()}
							</Button>
						)}
						<Button
							type="submit"
							disabled={isPending || !hasChanges || hoursInvalid}
						>
							{isPending ? pendingLabel : submitLabel}
						</Button>
					</div>
				</>
			)}
		</form>
	);
}
