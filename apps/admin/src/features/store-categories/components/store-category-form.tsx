import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@bibs/ui/components/native-select";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { type SubmitHandler, useForm } from "react-hook-form";
import {
	type StoreCategoryFormData,
	storeCategoryFormSchema,
} from "@/features/store-categories/schemas/store-category";

interface MacroOption {
	id: string;
	name: string;
}

interface StoreCategoryFormProps {
	defaultValues?: StoreCategoryFormData;
	macros: MacroOption[];
	macrosLoading?: boolean;
	onSubmit: (data: StoreCategoryFormData) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
}

export function StoreCategoryForm({
	defaultValues,
	macros,
	macrosLoading,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
}: StoreCategoryFormProps) {
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<StoreCategoryFormData>({
		resolver: zodResolver(storeCategoryFormSchema),
		defaultValues: defaultValues ?? { name: "", macroCategoryId: "" },
	});

	// Reset form when defaultValues change (e.g. switching between edit targets)
	useEffect(() => {
		if (defaultValues) {
			reset(defaultValues);
		}
	}, [defaultValues, reset]);

	const onFormSubmit: SubmitHandler<StoreCategoryFormData> = (data) => {
		onSubmit(data);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.macroCategoryId}>
					<FieldLabel htmlFor="store-category-macro">
						Macro Categoria
					</FieldLabel>
					<NativeSelect
						id="store-category-macro"
						className="w-full"
						disabled={macrosLoading}
						{...register("macroCategoryId")}
					>
						<NativeSelectOption value="">
							{macrosLoading
								? "Caricamento..."
								: "Seleziona macro categoria..."}
						</NativeSelectOption>
						{macros.map((mc) => (
							<NativeSelectOption key={mc.id} value={mc.id}>
								{mc.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<FieldError errors={[errors.macroCategoryId]} />
				</Field>

				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="store-category-name">Nome</FieldLabel>
					<Input
						id="store-category-name"
						placeholder="Es. Panetteria"
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>
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
	);
}
