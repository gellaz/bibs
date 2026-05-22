import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { FilterIcon, XIcon } from "lucide-react";
import { useState } from "react";
import {
	type FilterValue,
	ProductsFilterPopover,
} from "./products-filter-popover";

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

	return (
		<div className="space-y-2">
			<ProductsFilterPopover
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

			{hasPriceFilter && (
				<div className="flex flex-wrap items-center gap-1.5">
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
				</div>
			)}
		</div>
	);
}
