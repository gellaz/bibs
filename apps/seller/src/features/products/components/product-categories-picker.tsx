import { Label } from "@bibs/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

// Radix rifiuta value="" su un SelectItem, quindi la voce «nessuna categoria»
// viaggia con un sentinella che il gestore ritraduce in null. È l'unico modo
// che il venditore ha per togliere una categoria già assegnata senza passare
// dal cambio di macro (che sovrascriverebbe anche l'aliquota IVA).
const NO_CATEGORY = "__none__";

interface ProductCategoriesPickerProps {
	macroCategoryId: string | null;
	categoryId: string | null | undefined;
	onMacroChange: (
		macroId: string | null,
		suggestedVatRate?: "22" | "10" | "5" | "4" | "0",
	) => void;
	onCategoryChange: (categoryId: string | null) => void;
	required?: boolean;
}

export function ProductCategoriesPicker({
	macroCategoryId,
	categoryId,
	onMacroChange,
	onCategoryChange,
	required = false,
}: ProductCategoriesPickerProps) {
	const { data: macros = [] } = useQuery({
		queryKey: ["product-macro-categories"],
		queryFn: async () => {
			const response = await api()["product-macro-categories"].get({
				query: { page: 1, limit: 100 },
			});
			return unwrap(response, "Errore nel caricamento macro-categorie").data;
		},
	});

	const { data: categories = [] } = useQuery({
		queryKey: ["product-categories", macroCategoryId],
		queryFn: async () => {
			const response = await api()["product-categories"].get({
				query: {
					page: 1,
					limit: 100,
					macroCategoryId: macroCategoryId ?? undefined,
				},
			});
			return unwrap(response, "Errore nel caricamento categorie").data;
		},
		enabled: !!macroCategoryId,
	});

	return (
		<div className="@container grid gap-4 @md:grid-cols-2">
			<div className="space-y-2">
				<Label>Macrocategoria{required && " *"}</Label>
				<Select
					value={macroCategoryId ?? ""}
					onValueChange={(v) =>
						onMacroChange(
							v || null,
							macros.find((m) => m.id === v)?.suggestedVatRate,
						)
					}
				>
					<SelectTrigger className="w-full">
						<SelectValue placeholder="Seleziona una macrocategoria" />
					</SelectTrigger>
					<SelectContent>
						{macros.map((m) => (
							<SelectItem key={m.id} value={m.id}>
								{m.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{macroCategoryId && (
				<div className="space-y-2">
					<Label>Categoria{required && " *"}</Label>
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
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Seleziona una categoria" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NO_CATEGORY}>Nessuna categoria</SelectItem>
							{categories.map((c) => (
								<SelectItem key={c.id} value={c.id}>
									{c.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
		</div>
	);
}
