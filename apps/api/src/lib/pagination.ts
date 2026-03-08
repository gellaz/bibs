import { t } from "elysia";
import { config } from "@/lib/config";

const { defaultLimit, maxLimit } = config.pagination;

/**
 * Reusable TypeBox schema for pagination query parameters.
 * Use in route definitions: `query: PaginationQuery`
 */
export const PaginationQuery = t.Object({
	page: t.Optional(
		t.Number({ minimum: 1, default: 1, description: "Numero di pagina" }),
	),
	limit: t.Optional(
		t.Number({
			minimum: 1,
			maximum: maxLimit,
			default: defaultLimit,
			description: "Elementi per pagina",
		}),
	),
});

/**
 * Parses pagination query params into page, limit, offset.
 */
export function parsePagination(query: { page?: number; limit?: number }) {
	const limit = query.limit ?? defaultLimit;
	const page = query.page ?? 1;
	const offset = (page - 1) * limit;
	return { page, limit, offset };
}
