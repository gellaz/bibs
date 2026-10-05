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
import { m } from "@/paraglide/messages";
import { CHARACTERISTIC_DATA_TYPES, dataTypeLabel } from "../data-type";
import { characteristicUpdateImpact, confirmDescription } from "../impact";
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
						<FieldLabel htmlFor="characteristic-name">
							{m.common_name()}
						</FieldLabel>
						<Input
							id="characteristic-name"
							placeholder={m.characteristics_name_placeholder()}
							{...register("name")}
						/>
						<FieldError errors={[errors.name]} />
					</Field>

					<Field>
						<FieldLabel htmlFor="characteristic-type">
							{m.common_type()}
						</FieldLabel>
						<NativeSelect
							id="characteristic-type"
							className="w-full"
							{...register("dataType")}
						>
							{CHARACTERISTIC_DATA_TYPES.map((d) => (
								<NativeSelectOption key={d} value={d}>
									{dataTypeLabel(d)}
								</NativeSelectOption>
							))}
						</NativeSelect>
						{baseline && baseline.valueCount > 0 && (
							<FieldDescription>
								{baseline.valueCount === 1
									? m.characteristics_type_change_hint_one({ count: 1 })
									: m.characteristics_type_change_hint({
											count: baseline.valueCount,
										})}
							</FieldDescription>
						)}
					</Field>

					{dataType === "number" && (
						<Field data-invalid={!!errors.unit}>
							<FieldLabel htmlFor="characteristic-unit">
								{m.characteristics_unit()}
							</FieldLabel>
							<Input
								id="characteristic-unit"
								placeholder={m.characteristics_unit_placeholder()}
								{...register("unit")}
							/>
							<FieldDescription>
								{m.characteristics_unit_hint()}
							</FieldDescription>
							<FieldError errors={[errors.unit]} />
						</Field>
					)}

					{dataType === "enum" && (
						<Field data-invalid={!!errors.options}>
							<FieldLabel>{m.characteristics_options()}</FieldLabel>
							<div className="space-y-2">
								{/* Colore, il caso reale più estremo, ha 17 opzioni: senza un
								limite di altezza qui la finestra di dialogo (che non ha un suo
								scroll) sfora il viewport e il pulsante Salva diventa
								irraggiungibile senza ridimensionare il browser. */}
								<div className="max-h-[min(18rem,35vh)] space-y-2 overflow-y-auto pr-1">
									{fields.map((field, index) => (
										<div key={field.id} className="space-y-1">
											<div className="flex items-center gap-2">
												<Input
													aria-label={m.characteristics_option_aria({
														n: index + 1,
													})}
													{...register(`options.${index}.value`)}
												/>
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													aria-label={m.characteristics_remove_option_aria({
														n: index + 1,
													})}
													onClick={() => remove(index)}
												>
													<XIcon className="size-4" />
												</Button>
											</div>
											<FieldError errors={[errors.options?.[index]?.value]} />
										</div>
									))}
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => append({ value: "" })}
								>
									<PlusIcon />
									{m.characteristics_add_option()}
								</Button>
							</div>
							<FieldDescription>
								{m.characteristics_options_hint()}
							</FieldDescription>
							<FieldError errors={[errors.options?.root ?? errors.options]} />
						</Field>
					)}
				</div>

				<div className="flex justify-end gap-3">
					<Button type="button" variant="outline" onClick={onCancel}>
						{m.common_cancel()}
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
						<AlertDialogTitle>
							{m.characteristics_confirm_title()}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmDescription(typeChanged, pending?.affected ?? 0)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setPending(null)}>
							{m.common_cancel()}
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
							{m.characteristics_confirm_action()}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
