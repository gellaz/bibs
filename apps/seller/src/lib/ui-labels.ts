import type { DataPaginationLabels } from "@bibs/ui/custom/data-pagination";
import type { TableColumnsToggleLabels } from "@bibs/ui/custom/table-columns-toggle";
import { m } from "@/paraglide/messages";

// Testi dei componenti condivisi di @bibs/ui nella lingua corrente. Funzioni e
// non costanti: vanno lette a ogni render, dopo un cambio di lingua.

export function dataPaginationLabels(): DataPaginationLabels {
	return {
		previous: m.common_pagination_previous(),
		next: m.common_pagination_next(),
		page: (page) => m.common_pagination_page({ page }),
	};
}

export function tableColumnsToggleLabels(): TableColumnsToggleLabels {
	return {
		trigger: m.common_columns_trigger(),
		menuTitle: m.common_columns_title(),
		reset: m.common_columns_reset(),
		locked: m.common_columns_locked(),
	};
}
