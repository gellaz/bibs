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
 * Pagination + optional status/search/sort for seller list endpoints.
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
	search: t.Optional(
		t.String({
			maxLength: 100,
			description: "Ricerca testuale su nome, email, ragione sociale o P.IVA",
		}),
	),
	sortBy: t.Optional(
		t.Union([t.Literal("name"), t.Literal("createdAt")], {
			default: "createdAt",
			description: "Campo di ordinamento",
		}),
	),
	sortOrder: t.Optional(
		t.Union([t.Literal("asc"), t.Literal("desc")], {
			default: "desc",
			description: "Direzione di ordinamento",
		}),
	),
});

/**
 * Pagination + optional search/sort for category list endpoints.
 */
export const CategoryListQuery = t.Object({
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
	search: t.Optional(
		t.String({
			maxLength: 100,
			description: "Ricerca testuale sul nome",
		}),
	),
	sortBy: t.Optional(
		t.Union([t.Literal("name"), t.Literal("createdAt")], {
			default: "name",
			description: "Campo di ordinamento",
		}),
	),
	sortOrder: t.Optional(
		t.Union([t.Literal("asc"), t.Literal("desc")], {
			default: "asc",
			description: "Direzione di ordinamento",
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
