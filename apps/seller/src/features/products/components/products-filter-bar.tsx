import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { FilterIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useSellerCategoriesInUse } from "../hooks/use-seller-categories-in-use";
import { type FilterValue, ProductsFilterSheet } from "./products-filter-sheet";

type StatusFilter = "active" | "disabled" | "trashed";

interface ProductsFilterBarProps {
	value: FilterValue;
	onChange: (next: FilterValue) => void;
	storeId: string | undefined;
	statusFilter: StatusFilter | undefined;
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

function ChipRemoveButton({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			className="hover:bg-foreground/10 -mr-0.5 flex size-4 items-center justify-center rounded-full"
			onClick={onClick}
		>
			<XIcon className="size-3" />
		</button>
	);
}

export function ProductsFilterBar({
	value,
	onChange,
	storeId,
	statusFilter,
}: ProductsFilterBarProps) {
	const [open, setOpen] = useState(false);

	const categoryIds = value.categoryIds ?? [];
	const activeCount =
		categoryIds.length + (value.minPrice ? 1 : 0) + (value.maxPrice ? 1 : 0);
	const hasPriceFilter = Boolean(value.minPrice || value.maxPrice);

	const { data: categories } = useSellerCategoriesInUse(storeId, statusFilter);

	const selectedCategories = useMemo(() => {
		if (categoryIds.length === 0 || !categories) return [];
		return categoryIds
			.map((id) => categories.find((c) => c.id === id))
			.filter((c): c is NonNullable<typeof c> => Boolean(c));
	}, [categoryIds, categories]);

	const removeCategory = (id: string) => {
		const next = categoryIds.filter((cid) => cid !== id);
		onChange({
			...value,
			categoryIds: next.length === 0 ? undefined : next,
		});
	};

	return (
		<>
			<ProductsFilterSheet
				value={value}
				onChange={onChange}
				storeId={storeId}
				statusFilter={statusFilter}
				open={open}
				onOpenChange={setOpen}
				trigger={
					<Button variant="outline" className="relative gap-2">
						<FilterIcon className="size-4" />
						Filtri
						{activeCount > 0 && (
							<span
								role="status"
								aria-label={`${activeCount} filtri attivi`}
								className="bg-cobalt-soft text-cobalt-deep ring-background absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2"
							>
								{activeCount}
							</span>
						)}
					</Button>
				}
			/>

			{selectedCategories.map((c) => (
				<Badge key={c.id} variant="secondary" className="gap-1 pr-1">
					<span>
						<span className="text-muted-foreground">
							{c.macroCategory.name}:
						</span>{" "}
						<span className="font-medium">{c.name}</span>
					</span>
					<ChipRemoveButton
						label={`Rimuovi filtro categoria ${c.name}`}
						onClick={() => removeCategory(c.id)}
					/>
				</Badge>
			))}
			{/* Placeholder per categoryIds in URL ma cache non ancora pronta (loader iniziale). */}
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
					<ChipRemoveButton
						label="Rimuovi filtro prezzo"
						onClick={() =>
							onChange({
								...value,
								minPrice: undefined,
								maxPrice: undefined,
							})
						}
					/>
				</Badge>
			)}
		</>
	);
}
