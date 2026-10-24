import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { SelectCombobox } from "@bibs/ui/custom/select-combobox";
import { Controller, type SubmitHandler, useForm } from "react-hook-form";
import {
	type ProductCategoryFormData,
	productCategoryFormSchema,
} from "@/features/product-categories/schemas/product-category";
import { zodResolver } from "@/lib/zod-resolver";
import { m } from "@/paraglide/messages";

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
	// Niente `reset(defaultValues)` in un effetto: il pannello passa un oggetto
	// nuovo a ogni render e il reset riscriveva i campi prima del submit (si
	// salvava il nome vecchio). Il dialog monta un form per riga (`key`).
	const {
		register,
		control,
		handleSubmit,
		formState: { errors },
	} = useForm<ProductCategoryFormData>({
		resolver: zodResolver(productCategoryFormSchema),
		defaultValues: defaultValues ?? { name: "", macroCategoryId: "" },
	});

	const onFormSubmit: SubmitHandler<ProductCategoryFormData> = (data) => {
		onSubmit(data);
	};

	return (
		<form onSubmit={handleSubmit(onFormSubmit)}>
			<div className="space-y-4 py-4">
				<Field data-invalid={!!errors.macroCategoryId}>
					<FieldLabel htmlFor="product-category-macro">
						{m.categories_macro_column()}
					</FieldLabel>
					<Controller
						control={control}
						name="macroCategoryId"
						render={({ field }) => (
							<SelectCombobox
								id="product-category-macro"
								ref={field.ref}
								options={macros.map((mc) => ({ value: mc.id, label: mc.name }))}
								value={field.value || null}
								onChange={(v) => field.onChange(v ?? "")}
								placeholder={
									macrosLoading
										? m.common_loading()
										: m.categories_macro_select_placeholder()
								}
								emptyText={m.categories_macro_search_empty()}
								clearLabel={(name) => m.common_remove_named({ name })}
								disabled={macrosLoading}
								aria-invalid={!!errors.macroCategoryId}
							/>
						)}
					/>
					<FieldError errors={[errors.macroCategoryId]} />
				</Field>

				<Field data-invalid={!!errors.name}>
					<FieldLabel htmlFor="product-category-name">
						{m.common_name()}
					</FieldLabel>
					<Input
						id="product-category-name"
						placeholder={m.categories_product_name_placeholder()}
						{...register("name")}
					/>
					<FieldError errors={[errors.name]} />
				</Field>
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
	);
}
