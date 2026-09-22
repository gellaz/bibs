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

interface ProductCategoriesPickerProps {
	macroCategoryId: string | null;
	categoryId: string | null;
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
						value={categoryId ?? ""}
						onValueChange={(v) => onCategoryChange(v || null)}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Seleziona una categoria" />
						</SelectTrigger>
						<SelectContent>
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
