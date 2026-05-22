import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { FilterIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useAllProductCategories } from "../hooks/use-all-product-categories";
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

	const categoryIds = value.categoryIds ?? [];
	const activeCount =
		categoryIds.length + (value.minPrice ? 1 : 0) + (value.maxPrice ? 1 : 0);

	const { data: categories } = useAllProductCategories();

	const selectedCategories = useMemo(() => {
		if (categoryIds.length === 0 || !categories) return [];
		return categoryIds
			.map((id) => categories.find((c) => c.id === id))
			.filter((c): c is NonNullable<typeof c> => Boolean(c));
	}, [categoryIds, categories]);

	const hasPriceFilter = Boolean(value.minPrice || value.maxPrice);

	const removeCategory = (id: string) => {
		const next = categoryIds.filter((cid) => cid !== id);
		onChange({
			...value,
			categoryIds: next.length === 0 ? undefined : next,
		});
	};

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
					{selectedCategories.map((c) => (
						<Badge key={c.id} variant="secondary" className="gap-1 pr-1">
							<span>
								<span className="text-muted-foreground">
									{c.macroCategory.name}:
								</span>{" "}
								<span className="font-medium">{c.name}</span>
							</span>
							<button
								type="button"
								aria-label={`Rimuovi filtro categoria ${c.name}`}
								className="hover:bg-foreground/10 -mr-0.5 flex size-4 items-center justify-center rounded-full"
								onClick={() => removeCategory(c.id)}
							>
								<XIcon className="size-3" />
							</button>
						</Badge>
					))}
					{/* Mostra placeholder per categorie selezionate ma non ancora caricate dalla cache. */}
					{!categories && categoryIds.length > 0 && (
						<Badge variant="secondary" className="text-muted-foreground">
							{categoryIds.length} categori
							{categoryIds.length === 1 ? "a" : "e"}
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
