import { Button } from "@bibs/ui/components/button";
import { FilterIcon } from "lucide-react";
import { useState } from "react";
import { type FilterValue, ProductsFilterSheet } from "./products-filter-sheet";

type StatusFilter = "active" | "disabled" | "trashed";

interface ProductsFilterBarProps {
	value: FilterValue;
	onChange: (next: FilterValue) => void;
	storeId: string | undefined;
	statusFilter: StatusFilter | undefined;
	totalResults: number | undefined;
}

export function ProductsFilterBar({
	value,
	onChange,
	storeId,
	statusFilter,
	totalResults,
}: ProductsFilterBarProps) {
	const [open, setOpen] = useState(false);

	const activeCount =
		(value.categoryIds?.length ?? 0) +
		(value.minPrice ? 1 : 0) +
		(value.maxPrice ? 1 : 0);

	return (
		<ProductsFilterSheet
			value={value}
			onChange={onChange}
			storeId={storeId}
			statusFilter={statusFilter}
			totalResults={totalResults}
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
	);
}
