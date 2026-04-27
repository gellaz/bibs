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
	type ProductCategoryFormData,
	productCategoryFormSchema,
} from "@/features/product-categories/schemas/product-category";

interface MacroOption {
	id: string;
	name: string;
}

interface ProductCategoryFormProps {
	defaultValues?: ProductCategoryFormData;
	macros: MacroOption[];
	macrosLoading?: boolean;
	onSubmit: (data: ProductCategoryFormData) => void;
	onCancel: () => void;
	isPending: boolean;
	submitLabel: string;
	pendingLabel: string;
}

export function ProductCategoryForm({
	defaultValues,
	macros,
	macrosLoading,
	onSubmit,
	onCancel,
	isPending,
	submitLabel,
	pendingLabel,
}: ProductCategoryFormProps) {
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<ProductCategoryFormData>({
		resolver: zodResolver(productCategoryFormSchema),
		defaultValues: defaultValues ?? { name: "", macroCategoryId: "" },
	});

	useEffect(() => {
		if (defaultValues) {
			reset(defaultValues);
		}
	}, [defaultValues, reset]);

	const onFormSubmit: SubmitHandler<ProductCategoryFormData> = (data) => {
		onSubmit(data);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.macroCategoryId}>
					<FieldLabel htmlFor="product-category-macro">
						Macro Categoria
					</FieldLabel>
					<NativeSelect
						id="product-category-macro"
						className="w-full"
						disabled={macrosLoading}
						{...register("macroCategoryId")}
					>
						<NativeSelectOption value="">
							{macrosLoading
								? "Caricamento..."
								: "Seleziona macro categoria..."}
						</NativeSelectOption>
						{macros.map((m) => (
							<NativeSelectOption key={m.id} value={m.id}>
								{m.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<FieldError errors={[errors.macroCategoryId]} />
				</Field>

				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="product-category-name">Nome</FieldLabel>
					<Input
						id="product-category-name"
						placeholder="Es. Smartphone"
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
