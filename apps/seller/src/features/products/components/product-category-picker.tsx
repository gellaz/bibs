import { Label } from "@bibs/ui/components/label";
import { SelectCombobox } from "@bibs/ui/custom/select-combobox";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { catalogApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface ProductCategoryPickerProps {
	macroCategoryId: string | null;
	categoryId: string | null | undefined;
	onMacroChange: (
		macroId: string | null,
		suggestedVatRate?: "22" | "10" | "5" | "4" | "0",
	) => void;
	onCategoryChange: (categoryId: string | null) => void;
	required?: boolean;
}

/** Le macro-categorie prodotto, con l'aliquota IVA che suggeriscono. */
export function useProductMacroCategories() {
	return useQuery({
		queryKey: ["product-macro-categories"],
		queryFn: async () => {
			const response = await catalogApi["product-macro-categories"].$get({
				query: { page: 1, limit: 100 },
			});
			return (
				await unwrapJson(response, m.products_category_macro_load_error())
			).data;
		},
	});
}

export function ProductCategoryPicker({
	macroCategoryId,
	categoryId,
	onMacroChange,
	onCategoryChange,
	required = false,
}: ProductCategoryPickerProps) {
	const macroSelectId = useId();
	const categorySelectId = useId();
	const { data: macros = [] } = useProductMacroCategories();

	const { data: categories = [], isSuccess: categoriesLoaded } = useQuery({
		queryKey: ["product-categories", macroCategoryId],
		queryFn: async () => {
			const response = await catalogApi["product-categories"].$get({
				query: {
					page: 1,
					limit: 100,
					macroCategoryId: macroCategoryId ?? undefined,
				},
			});
			return (await unwrapJson(response, m.products_category_load_error()))
				.data;
		},
		enabled: !!macroCategoryId,
	});

	return (
		<div className="@container grid gap-4 @md:grid-cols-2">
			<div className="space-y-2">
				<Label htmlFor={macroSelectId}>
					{m.products_category_macro_label()}
					{required && " *"}
				</Label>
				<SelectCombobox
					id={macroSelectId}
					options={macros.map((macro) => ({
						value: macro.id,
						label: macro.name,
					}))}
					value={macroCategoryId}
					onChange={(v) =>
						onMacroChange(
							v,
							macros.find((macro) => macro.id === v)?.suggestedVatRate,
						)
					}
					placeholder={m.products_category_macro_placeholder()}
					emptyText={m.products_category_macro_search_empty()}
					clearLabel={(name) => m.common_remove_named({ name })}
				/>
			</div>

			{macroCategoryId && (
				<div className="space-y-2">
					<Label htmlFor={categorySelectId}>
						{m.products_category_label()}
						{required && " *"}
					</Label>
					<SelectCombobox
						id={categorySelectId}
						options={categories.map((c) => ({ value: c.id, label: c.name }))}
						value={categoryId ?? null}
						onChange={onCategoryChange}
						placeholder={m.products_category_placeholder()}
						emptyText={m.products_category_search_empty()}
						clearLabel={(name) => m.common_remove_named({ name })}
						disabled={categoriesLoaded && categories.length === 0}
					/>
					{categoriesLoaded && categories.length === 0 && (
						<p className="text-muted-foreground text-sm">
							{m.products_category_empty()}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
