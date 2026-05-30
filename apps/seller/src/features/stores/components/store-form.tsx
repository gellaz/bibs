import { CreateStoreBody } from "@bibs/api/schemas";
import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { MunicipalityCombobox } from "@bibs/ui/components/municipality-combobox";
import { Separator } from "@bibs/ui/components/separator";
import { Textarea } from "@bibs/ui/components/textarea";
import { typeboxResolver } from "@hookform/resolvers/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import "@/lib/typebox-formats";
import { PlusIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
	Controller,
	type SubmitHandler,
	useFieldArray,
	useForm,
} from "react-hook-form";
import { useMunicipalities } from "@/hooks/use-municipalities";
import {
	DEFAULT_OPENING_HOURS,
	OpeningHoursEditor,
} from "./opening-hours-editor";

export type StoreFormData = Static<typeof CreateStoreBody>;
const compiledSchema = TypeCompiler.Compile(CreateStoreBody);

interface DaySchedule {
	dayOfWeek: number;
	slots: { open: string; close: string }[];
}

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
	onCancel: () => void;
	isPending: boolean;
	defaultValues?: Partial<StoreFormData>;
	submitLabel?: string;
	pendingLabel?: string;
	onNameChange?: (name: string) => void;
	readOnly?: boolean;
}

function FormSection({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<section className="grid gap-6 md:grid-cols-[18rem_1fr] md:gap-12">
			<header className="space-y-1.5">
				<h2 className="font-display text-base font-semibold tracking-tight text-foreground">
					{title}
				</h2>
				{description && (
					<p className="text-sm leading-relaxed text-muted-foreground">
						{description}
					</p>
				)}
			</header>
			<div className="space-y-4">{children}</div>
		</section>
	);
}

export function StoreForm({
	onSubmit,
	onCancel,
	isPending,
	defaultValues,
	submitLabel = "Crea Negozio",
	pendingLabel = "Creazione...",
	onNameChange,
	readOnly = false,
}: StoreFormProps) {
	// openingHours is kept outside react-hook-form, so RHF's isDirty does not
	// react to changes here. Snapshot the value at mount and diff against it so
	// opening-hours-only edits can still enable Save (see store form audit).
	const [initialOpeningHours] = useState<DaySchedule[]>(
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
		formState: { errors, isDirty },
	} = useForm<StoreFormData>({
		resolver: typeboxResolver(compiledSchema),
		defaultValues: {
			name: "",
			description: "",
			addressLine1: "",
			addressLine2: "",
			municipalityId: "",
			zipCode: "",
			websiteUrl: "",
			phoneNumbers: [],
			...defaultValues,
		},
	});

	const nameValue = watch("name");
	useEffect(() => {
		onNameChange?.(nameValue);
	}, [nameValue, onNameChange]);

	const openingHoursDirty =
		serializeOpeningHours(openingHours) !==
		serializeOpeningHours(initialOpeningHours);

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
		const cleaned: StoreFormData = {
			...data,
			description: data.description || undefined,
			addressLine2: data.addressLine2 || undefined,
			websiteUrl: data.websiteUrl || undefined,
			openingHours: openingHours.length > 0 ? openingHours : undefined,
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
				title="Identità"
				description="Come si chiama il negozio e con che voce si racconta."
			>
				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="store-name" required>
						Nome
					</FieldLabel>
					<Input
						id="store-name"
						placeholder="Es. Bottega del Gusto"
						autoFocus
						disabled={readOnly}
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>

				<Field>
					<FieldLabel htmlFor="store-description">Descrizione</FieldLabel>
					<Textarea
						id="store-description"
						placeholder="Una riga sul negozio (opzionale)"
						rows={2}
						disabled={readOnly}
						{...register("description")}
					/>
				</Field>
			</FormSection>

			<Separator />

			<FormSection
				title="Indirizzo"
				description="Dove si trova fisicamente, come ti raggiungono."
			>
				<Field data-invalid={!!errors.addressLine1}>
					<FieldLabel htmlFor="store-address1" required>
						Indirizzo
					</FieldLabel>
					<Input
						id="store-address1"
						placeholder="Via Roma 1"
						disabled={readOnly}
						{...register("addressLine1")}
					/>
					<FieldError errors={[errors.addressLine1]} />
				</Field>

				<Field>
					<FieldLabel htmlFor="store-address2">Indirizzo (riga 2)</FieldLabel>
					<Input
						id="store-address2"
						placeholder="Interno, piano, scala (opzionale)"
						disabled={readOnly}
						{...register("addressLine2")}
					/>
				</Field>

				<div className="grid grid-cols-[1fr_auto] gap-4">
					<Field data-invalid={!!errors.municipalityId}>
						<FieldLabel htmlFor="municipalityId" required>
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
									aria-invalid={!!errors.municipalityId}
								/>
							)}
						/>
						<FieldError errors={[errors.municipalityId]} />
					</Field>
					<Field data-invalid={!!errors.zipCode} className="w-32">
						<FieldLabel htmlFor="store-zip" required>
							CAP
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
				title="Orari di apertura"
				description="Fasce orarie per ogni giorno. Le festività particolari si gestiscono dal calendario."
			>
				<OpeningHoursEditor
					value={openingHours}
					onChange={setOpeningHours}
					readOnly={readOnly}
				/>
			</FormSection>

			<Separator />

			<FormSection
				title="Contatti"
				description="Numeri di telefono e sito web pubblico."
			>
				<div className="space-y-2">
					<div className="flex items-center justify-between">
						<Label>Numeri di telefono</Label>
						{!readOnly && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => append({ label: "", number: "" })}
							>
								<PlusIcon className="size-3" />
								<span>Aggiungi</span>
							</Button>
						)}
					</div>
					{fields.length === 0 ? (
						<p className="text-sm text-muted-foreground italic">
							Nessun numero impostato.
						</p>
					) : (
						<div className="space-y-2">
							{fields.map((field, index) => (
								<div key={field.id} className="flex gap-2">
									<Input
										placeholder="Etichetta (es. Principale)"
										className="w-1/3"
										disabled={readOnly}
										{...register(`phoneNumbers.${index}.label`)}
									/>
									<Field
										data-invalid={!!errors.phoneNumbers?.[index]?.number}
										className="flex-1"
									>
										<Input
											placeholder="Numero di telefono"
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
					<FieldLabel htmlFor="store-website">Sito web</FieldLabel>
					<Input
						id="store-website"
						type="url"
						placeholder="https://esempio.it (opzionale)"
						disabled={readOnly}
						{...register("websiteUrl", {
							setValueAs: (v: string) => v || undefined,
						})}
					/>
					<FieldError errors={[errors.websiteUrl]} />
				</Field>
			</FormSection>

			{!readOnly && (
				<>
					<Separator />
					<div className="flex justify-end gap-3">
						<Button type="button" variant="outline" onClick={onCancel}>
							Annulla
						</Button>
						<Button
							type="submit"
							disabled={isPending || (!isDirty && !openingHoursDirty)}
						>
							{isPending ? pendingLabel : submitLabel}
						</Button>
					</div>
				</>
			)}
		</form>
	);
}
