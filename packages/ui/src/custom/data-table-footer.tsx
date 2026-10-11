import {
	DataPagination,
	type DataPaginationLabels,
} from "~/custom/data-pagination";
import { PageSizeSelector } from "~/custom/page-size-selector";
import { clampPage } from "~/lib/pagination-search";

export interface DataTableFooterLabels {
	rowsPerPage: string;
	pagination: DataPaginationLabels;
}

interface DataTableFooterProps {
	page: number;
	pageSize: number;
	total: number;
	/** Stessa firma di `DataPagination`: `replace` quando riporta dentro una pagina fuori range. */
	onPageChange: (page: number, options?: { replace?: boolean }) => void;
	onPageSizeChange: (pageSize: number) => void;
	/** Testo del range per entità, es. `21–40 di 45 ordini`. */
	rangeLabel: (range: { start: number; end: number; total: number }) => string;
	labels: DataTableFooterLabels;
}

/** Piede delle liste paginate: range, righe per pagina, paginazione. */
export function DataTableFooter({
	page,
	pageSize,
	total,
	onPageChange,
	onPageSizeChange,
	rangeLabel,
	labels,
}: DataTableFooterProps) {
	// A 0 non c'è nulla da mostrare né da correggere: DataPagination riporta
	// dentro una pagina fuori range solo quando il totale è arrivato.
	if (total === 0) return null;

	const totalPages = Math.ceil(total / pageSize);
	const current = clampPage(page, totalPages);
	const start = Math.min((current - 1) * pageSize + 1, total);
	const end = Math.min(current * pageSize, total);

	return (
		<div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
			<p className="text-muted-foreground text-sm tabular-nums">
				{rangeLabel({ start, end, total })}
			</p>
			<div className="flex items-center gap-4">
				<PageSizeSelector
					label={labels.rowsPerPage}
					pageSize={pageSize}
					onPageSizeChange={onPageSizeChange}
				/>
				<DataPagination
					labels={labels.pagination}
					page={page}
					totalPages={totalPages}
					onPageChange={onPageChange}
				/>
			</div>
		</div>
	);
}
