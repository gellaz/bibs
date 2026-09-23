import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@bibs/ui/components/collapsible";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@bibs/ui/components/input-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@bibs/ui/components/toggle-group";
import { ChevronDownIcon } from "lucide-react";
import type { CategoryCharacteristic } from "../hooks/use-category-characteristics";
import {
	type CharacteristicFormValue,
	type CharacteristicFormValues,
	filledPhrase,
	isFilled,
	type SavedCharacteristicValue,
} from "../lib/characteristic-form";

// Radix rifiuta value="" su un SelectItem: «non indicato» viaggia così.
const NOT_SET = "__not_set__";

interface Props {
	definitions: CategoryCharacteristic[];
	values: CharacteristicFormValues;
	onChange: (characteristicId: string, value: CharacteristicFormValue) => void;
	/** Obbligatorie che l'ultimo tentativo di salvataggio ha trovato vuote. */
	errorIds: ReadonlySet<string>;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Valori salvati che il cambio di sotto-categoria farà perdere. */
	pendingLoss: SavedCharacteristicValue[];
}

export function ProductCharacteristicsSection({
	definitions,
	values,
	onChange,
	errorIds,
	open,
	onOpenChange,
	pendingLoss,
}: Props) {
	if (definitions.length === 0 && pendingLoss.length === 0) return null;

	const filled = definitions.filter((d) => isFilled(values[d.id])).length;
	const requiredEmpty = definitions.filter(
		(d) => d.required && !isFilled(values[d.id]),
	).length;

	return (
		<div className="space-y-3">
			{pendingLoss.length > 0 && (
				<p
					role="status"
					className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
				>
					Al salvataggio verranno eliminati {filledPhrase(pendingLoss.length)}{" "}
					della categoria precedente:{" "}
					{pendingLoss.map((v) => v.name).join(", ")}.
				</p>
			)}

			{definitions.length > 0 && (
				<Collapsible
					open={open}
					onOpenChange={onOpenChange}
					className="rounded-lg border border-warm-line"
				>
					<CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
						<span className="text-sm font-medium text-foreground">
							Caratteristiche
						</span>
						<span className="flex items-center gap-2 text-xs text-muted-foreground">
							<span>
								{filled} di {definitions.length} compilate
							</span>
							{requiredEmpty > 0 && (
								<span className="text-destructive">
									· {requiredEmpty}{" "}
									{requiredEmpty === 1 ? "obbligatoria" : "obbligatorie"} da
									compilare
								</span>
							)}
							<ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
						</span>
					</CollapsibleTrigger>
					<CollapsibleContent className="border-t border-warm-line px-4 py-4">
						<div className="@container">
							<div className="grid gap-4 @md:grid-cols-2">
								{definitions.map((def) => (
									<CharacteristicField
										key={def.id}
										def={def}
										value={values[def.id] ?? null}
										invalid={errorIds.has(def.id)}
										onChange={(v) => onChange(def.id, v)}
									/>
								))}
							</div>
						</div>
					</CollapsibleContent>
				</Collapsible>
			)}
		</div>
	);
}

function CharacteristicField({
	def,
	value,
	invalid,
	onChange,
}: {
	def: CategoryCharacteristic;
	value: CharacteristicFormValue;
	invalid: boolean;
	onChange: (value: CharacteristicFormValue) => void;
}) {
	const id = `characteristic-${def.id}`;
	return (
		<Field data-invalid={invalid}>
			<FieldLabel htmlFor={id} required={def.required}>
				{def.name}
			</FieldLabel>
			<CharacteristicControl
				id={id}
				def={def}
				value={value}
				onChange={onChange}
			/>
			{invalid && <FieldError errors={[{ message: "Obbligatoria" }]} />}
		</Field>
	);
}

function CharacteristicControl({
	id,
	def,
	value,
	onChange,
}: {
	id: string;
	def: CategoryCharacteristic;
	value: CharacteristicFormValue;
	onChange: (value: CharacteristicFormValue) => void;
}) {
	switch (def.dataType) {
		case "boolean":
			// Tre stati, non due: «Sì», «No» e «non indicato» (un secondo click
			// sulla voce attiva la deseleziona). Decisione P5 del piano PR 4.
			return (
				<ToggleGroup
					id={id}
					type="single"
					variant="outline"
					aria-label={def.name}
					value={value === true ? "yes" : value === false ? "no" : ""}
					onValueChange={(v) =>
						onChange(v === "yes" ? true : v === "no" ? false : null)
					}
					className="justify-start"
				>
					<ToggleGroupItem value="yes">Sì</ToggleGroupItem>
					<ToggleGroupItem value="no">No</ToggleGroupItem>
				</ToggleGroup>
			);
		case "number":
			return (
				<InputGroup>
					<InputGroupInput
						id={id}
						type="number"
						step="any"
						inputMode="decimal"
						value={typeof value === "string" ? value : ""}
						onChange={(e) => onChange(e.target.value)}
					/>
					{def.unit && (
						<InputGroupAddon align="inline-end">
							<InputGroupText>{def.unit}</InputGroupText>
						</InputGroupAddon>
					)}
				</InputGroup>
			);
		case "enum":
			return (
				<Select
					value={typeof value === "string" && value ? value : NOT_SET}
					onValueChange={(v) => onChange(v === NOT_SET ? null : v)}
				>
					<SelectTrigger id={id} className="w-full">
						<SelectValue placeholder="Non indicato" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={NOT_SET}>Non indicato</SelectItem>
						{def.options.map((o) => (
							<SelectItem key={o.id} value={o.id}>
								{o.value}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		case "text":
			return (
				<Input
					id={id}
					maxLength={2000}
					value={typeof value === "string" ? value : ""}
					onChange={(e) => onChange(e.target.value)}
				/>
			);
	}
}
