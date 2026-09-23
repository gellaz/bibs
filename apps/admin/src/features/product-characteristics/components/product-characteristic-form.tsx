import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@bibs/ui/components/alert-dialog";
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
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import type { CrudFormProps } from "@/features/crud/category-crud-panel";
import {
	CHARACTERISTIC_DATA_TYPES,
	DATA_TYPE_LABELS,
	productsPhrase,
} from "../data-type";
import { characteristicUpdateImpact } from "../impact";
import {
	type ProductCharacteristicFormData,
	type ProductCharacteristicSubmit,
	productCharacteristicFormSchema,
} from "../schemas/product-characteristic";

const EMPTY_FORM: ProductCharacteristicFormData = {
	name: "",
	dataType: "text",
	unit: "",
	options: [],
};

export function ProductCharacteristicForm({
	defaultValues,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
}: CrudFormProps<ProductCharacteristicSubmit>) {
	const baseline = defaultValues?.baseline;
	const {
		register,
		control,
		handleSubmit,
		watch,
		formState: { errors },
	} = useForm<ProductCharacteristicFormData>({
		resolver: zodResolver(productCharacteristicFormSchema),
		defaultValues: defaultValues?.form ?? EMPTY_FORM,
	});
	const { fields, append, remove } = useFieldArray({
		control,
		name: "options",
	});
	const dataType = watch("dataType");
	const [pending, setPending] = useState<{
		form: ProductCharacteristicFormData;
		affected: number;
	} | null>(null);

	const submit = (form: ProductCharacteristicFormData) => {
		const affected = baseline ? characteristicUpdateImpact(baseline, form) : 0;
		if (affected > 0) {
			setPending({ form, affected });
			return;
		}
		onSubmit({ form, baseline, confirmAffected: 0 });
	};

	const typeChanged =
		!!baseline && pending?.form.dataType !== baseline.dataType;

	return (
		<>
			<form onSubmit={handleSubmit(submit)}>
				<div className="space-y-4 py-4">
					<Field data-invalid={!!errors.name}>
						<FieldLabel htmlFor="characteristic-name">Nome</FieldLabel>
						<Input
							id="characteristic-name"
							placeholder="Es. Colore"
							{...register("name")}
						/>
						<FieldError errors={[errors.name]} />
					</Field>

					<Field>
						<FieldLabel htmlFor="characteristic-type">Tipo</FieldLabel>
						<NativeSelect
							id="characteristic-type"
							className="w-full"
							{...register("dataType")}
						>
							{CHARACTERISTIC_DATA_TYPES.map((d) => (
								<NativeSelectOption key={d} value={d}>
									{DATA_TYPE_LABELS[d]}
								</NativeSelectOption>
							))}
						</NativeSelect>
						{baseline && baseline.valueCount > 0 && (
							<FieldDescription>
								Cambiare tipo elimina i valori già compilati su{" "}
								{productsPhrase(baseline.valueCount)}.
							</FieldDescription>
						)}
					</Field>

					{dataType === "number" && (
						<Field data-invalid={!!errors.unit}>
							<FieldLabel htmlFor="characteristic-unit">
								Unità di misura
							</FieldLabel>
							<Input
								id="characteristic-unit"
								placeholder="Es. g, cm, W"
								{...register("unit")}
							/>
							<FieldDescription>
								Facoltativa. Cambiarla non converte i valori già inseriti.
							</FieldDescription>
							<FieldError errors={[errors.unit]} />
						</Field>
					)}

					{dataType === "enum" && (
						<Field data-invalid={!!errors.options}>
							<FieldLabel>Opzioni</FieldLabel>
							<div className="space-y-2">
								{fields.map((field, index) => (
									<div key={field.id} className="flex items-center gap-2">
										<Input
											aria-label={`Opzione ${index + 1}`}
											{...register(`options.${index}.value`)}
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={`Rimuovi opzione ${index + 1}`}
											onClick={() => remove(index)}
										>
											<XIcon className="size-4" />
										</Button>
									</div>
								))}
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => append({ value: "" })}
								>
									<PlusIcon />
									Aggiungi opzione
								</Button>
							</div>
							<FieldDescription>
								Rinominare un'opzione conserva i valori dei prodotti; rimuoverla
								li elimina.
							</FieldDescription>
							<FieldError errors={[errors.options?.root ?? errors.options]} />
						</Field>
					)}
				</div>

				<div className="flex justify-end gap-3">
					<Button type="button" variant="outline" onClick={onCancel}>
						Annulla
					</Button>
					<Button type="submit" disabled={isPending}>
						{isPending ? pendingLabel : submitLabel}
					</Button>
				</div>
			</form>

			<AlertDialog
				open={!!pending}
				onOpenChange={(open) => !open && setPending(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Conferma modifica</AlertDialogTitle>
						<AlertDialogDescription>
							{typeChanged
								? `Cambiando tipo, i valori già compilati su ${productsPhrase(pending?.affected ?? 0)} verranno eliminati definitivamente.`
								: `Le opzioni rimosse sono in uso: ${productsPhrase(pending?.affected ?? 0)} perderanno il valore, che verrà eliminato definitivamente.`}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setPending(null)}>
							Annulla
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								if (!pending) return;
								onSubmit({
									form: pending.form,
									baseline,
									confirmAffected: pending.affected,
								});
								setPending(null);
							}}
						>
							Elimina i valori e salva
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
