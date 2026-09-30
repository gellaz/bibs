const DEFAULT_LIMIT = 20;
// Cap dell'API sulla paginazione: oltre risponde 400.
const MAX_LIMIT = 100;

function positiveInt(value: unknown): number | undefined {
	const n = Number(value);
	return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/**
 * `page`/`limit` da search params non fidati (`?page=abc`, `?limit=1e9`):
 * interi ≥ 1, limit entro il cap dell'API, altrimenti i default.
 */
export function parsePaginationSearch(search: Record<string, unknown>): {
	page: number;
	limit: number;
} {
	return {
		page: positiveInt(search.page) ?? 1,
		limit: Math.min(positiveInt(search.limit) ?? DEFAULT_LIMIT, MAX_LIMIT),
	};
}

/**
 * La pagina riportata dentro `[1, totalPages]`. `?page=7` resta valido per
 * `parsePaginationSearch` anche quando le pagine sono scese a 5 (righe
 * cancellate, filtro più stretto): senza clamp la tabella resta vuota e la
 * paginazione non offre nessuna pagina a cui tornare.
 */
export function clampPage(page: number, totalPages: number): number {
	return Math.min(Math.max(1, page), Math.max(1, totalPages));
}
