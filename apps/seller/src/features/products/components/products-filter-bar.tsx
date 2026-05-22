import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { FilterIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
	type FilterValue,
	ProductsFilterPopover,
} from "./products-filter-popover";

interface ProductsFilterBarProps {
	value: FilterValue;
	onChange: (next: FilterValue) => void;
}

function formatPriceIt(decimal: string): string {
	const n = Number.parseFloat(decimal);
	if (Number.isNaN(n)) return decimal;
	return `${n.toLocaleString("it-IT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})} €`;
}

function priceChipLabel(min?: string, max?: string): string {
	if (min && max) return `${formatPriceIt(min)} – ${formatPriceIt(max)}`;
	if (min) return `≥ ${formatPriceIt(min)}`;
	if (max) return `≤ ${formatPriceIt(max)}`;
	return "";
}

export function ProductsFilterBar({ value, onChange }: ProductsFilterBarProps) {
	const [open, setOpen] = useState(false);

	const activeCount =
		(value.categoryId ? 1 : 0) +
		(value.minPrice ? 1 : 0) +
		(value.maxPrice ? 1 : 0);

	const { data: categories } = useQuery({
		queryKey: ["product-categories", "filter-all"],
		queryFn: async () => {
			const response = await api()["product-categories"].get({
				query: { page: 1, limit: 200 },
			});
			if (response.error) throw new Error("Errore caricamento categorie");
			return response.data.data;
		},
		enabled: Boolean(value.categoryId),
	});

	const categoryName = useMemo(() => {
		if (!value.categoryId || !categories) return null;
		return categories.find((c) => c.id === value.categoryId)?.name ?? null;
	}, [value.categoryId, categories]);

	const hasPriceFilter = Boolean(value.minPrice || value.maxPrice);

	return (
		<div className="space-y-2">
			<ProductsFilterPopover
				value={value}
				onChange={onChange}
				open={open}
				onOpenChange={setOpen}
				trigger={
					<Button variant="outline" size="sm" className="gap-2">
						<FilterIcon className="size-4" />
						Filtri
						{activeCount > 0 && (
							<Badge variant="secondary" className="ml-1">
								{activeCount}
							</Badge>
						)}
					</Button>
				}
			/>

			{activeCount > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					{value.categoryId && (
						<Badge variant="secondary" className="gap-1 pr-1">
							<span>
								Categoria:{" "}
								<span className="font-medium">{categoryName ?? "…"}</span>
							</span>
							<button
								type="button"
								aria-label="Rimuovi filtro categoria"
								className="hover:bg-foreground/10 -mr-0.5 flex size-4 items-center justify-center rounded-full"
								onClick={() => onChange({ ...value, categoryId: undefined })}
							>
								<XIcon className="size-3" />
							</button>
						</Badge>
					)}
					{hasPriceFilter && (
						<Badge variant="secondary" className="gap-1 pr-1">
							<span>
								Prezzo:{" "}
								<span className="font-medium">
									{priceChipLabel(value.minPrice, value.maxPrice)}
								</span>
							</span>
							<button
								type="button"
								aria-label="Rimuovi filtro prezzo"
								className="hover:bg-foreground/10 -mr-0.5 flex size-4 items-center justify-center rounded-full"
								onClick={() =>
									onChange({
										...value,
										minPrice: undefined,
										maxPrice: undefined,
									})
								}
							>
								<XIcon className="size-3" />
							</button>
						</Badge>
					)}
				</div>
			)}
		</div>
	);
}
