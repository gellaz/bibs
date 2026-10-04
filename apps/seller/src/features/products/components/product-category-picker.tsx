import { Label } from "@bibs/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

// Radix rifiuta value="" su un SelectItem, quindi la voce «nessuna categoria»
// viaggia con un sentinella che il gestore ritraduce in null. È l'unico modo
// che il venditore ha per togliere una categoria già assegnata senza passare
// dal cambio di macro (che sovrascriverebbe anche l'aliquota IVA).
const NO_CATEGORY = "__none__";

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
			const response = await api()["product-macro-categories"].get({
				query: { page: 1, limit: 100 },
			});
			return unwrap(response, m.products_category_macro_load_error()).data;
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
			const response = await api()["product-categories"].get({
				query: {
					page: 1,
					limit: 100,
					macroCategoryId: macroCategoryId ?? undefined,
				},
			});
			return unwrap(response, m.products_category_load_error()).data;
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
				<Select
					value={macroCategoryId ?? ""}
					onValueChange={(v) =>
						onMacroChange(
							v || null,
							macros.find((macro) => macro.id === v)?.suggestedVatRate,
						)
					}
				>
					<SelectTrigger id={macroSelectId} className="w-full">
						<SelectValue
							placeholder={m.products_category_macro_placeholder()}
						/>
					</SelectTrigger>
					<SelectContent>
						{macros.map((macro) => (
							<SelectItem key={macro.id} value={macro.id}>
								{macro.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{macroCategoryId && (
				<div className="space-y-2">
					<Label htmlFor={categorySelectId}>
						{m.products_category_label()}
						{required && " *"}
					</Label>
					<Select
						value={
							categoryId === undefined
								? ""
								: categoryId === null
									? NO_CATEGORY
									: categoryId
						}
						onValueChange={(v) =>
							onCategoryChange(!v || v === NO_CATEGORY ? null : v)
						}
					>
						<SelectTrigger id={categorySelectId} className="w-full">
							<SelectValue placeholder={m.products_category_placeholder()} />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NO_CATEGORY}>
								{m.products_category_none()}
							</SelectItem>
							{categories.map((c) => (
								<SelectItem key={c.id} value={c.id}>
									{c.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
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
