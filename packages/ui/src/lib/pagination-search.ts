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
