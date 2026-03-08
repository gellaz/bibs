import { t } from "elysia";
import { orderStatuses, orderTypes } from "@/db/schemas/order";
import { onboardingStatuses } from "@/db/schemas/seller";
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
 * Pagination + optional status/type filters for order list endpoints.
 */
export const OrderListQuery = t.Object({
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
	status: t.Optional(
		t.Union(
			orderStatuses.map((s) => t.Literal(s)),
			{
				description: "Filtra per stato dell'ordine",
			},
		),
	),
	type: t.Optional(
		t.Union(
			orderTypes.map((s) => t.Literal(s)),
			{
				description: "Filtra per tipo di ordine",
			},
		),
	),
});

/**
 * Pagination + optional onboarding status filter for seller list endpoints.
 */
export const SellerListQuery = t.Object({
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
	status: t.Optional(
		t.Union(
			onboardingStatuses.map((s) => t.Literal(s)),
			{
				description:
					"Filtra per stato di onboarding. Se omesso, restituisce solo i venditori con candidatura sottomessa (pending_review, active, rejected).",
			},
		),
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
