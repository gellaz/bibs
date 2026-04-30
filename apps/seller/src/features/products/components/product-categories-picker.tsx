import { Checkbox } from "@bibs/ui/components/checkbox";
import { Label } from "@bibs/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface ProductCategoriesPickerProps {
	macroCategoryId: string | null;
	categoryIds: string[];
	onMacroChange: (macroId: string | null) => void;
	onToggleCategory: (categoryId: string) => void;
	required?: boolean;
}

export function ProductCategoriesPicker({
	macroCategoryId,
	categoryIds,
	onMacroChange,
	onToggleCategory,
	required = false,
}: ProductCategoriesPickerProps) {
	const { data: macros = [] } = useQuery({
		queryKey: ["product-macro-categories"],
		queryFn: async () => {
			const response = await api()["product-macro-categories"].get({
				query: { page: 1, limit: 100 },
			});
			if (response.error)
				throw new Error("Errore nel caricamento macro-categorie");
			return response.data.data;
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
			if (response.error) throw new Error("Errore nel caricamento categorie");
			return response.data.data;
		},
		enabled: !!macroCategoryId,
	});

	return (
		<div className="space-y-3">
			<div className="space-y-2">
				<Label>Macrocategoria{required && " *"}</Label>
				<Select
					value={macroCategoryId ?? ""}
					onValueChange={(v) => onMacroChange(v || null)}
				>
					<SelectTrigger>
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
					<Label>
						Categorie{required && " *"}
						{categoryIds.length > 0 && (
							<span className="ml-1 text-xs font-normal text-muted-foreground">
								({categoryIds.length} selezionat
								{categoryIds.length === 1 ? "a" : "e"})
							</span>
						)}
					</Label>
					{categories.length > 0 ? (
						<div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
							{categories.map((cat) => (
								<label
									key={cat.id}
									htmlFor={`cat-${cat.id}`}
									className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
								>
									<Checkbox
										id={`cat-${cat.id}`}
										checked={categoryIds.includes(cat.id)}
										onCheckedChange={() => onToggleCategory(cat.id)}
									/>
									{cat.name}
								</label>
							))}
						</div>
					) : (
						<p className="text-xs text-muted-foreground">
							Nessuna categoria disponibile per questa macro
						</p>
					)}
				</div>
			)}
		</div>
	);
}
