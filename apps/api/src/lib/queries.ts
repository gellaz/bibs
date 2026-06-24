import { t } from "elysia";
import { orderStatuses, orderTypes } from "@/db/schemas/order";
import { onboardingStatuses } from "@/db/schemas/seller";
import { PaginationQuery } from "@/lib/pagination";

/**
 * Pagination + optional status/type filters for order list endpoints.
 */
export const OrderListQuery = t.Object({
	...PaginationQuery.properties,
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
	...PaginationQuery.properties,
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
 * Pagination + optional full-text + category + geo filters for product search.
 */
export const ProductSearchQuery = t.Object({
	...PaginationQuery.properties,
	q: t.Optional(
		t.String({ description: "Testo di ricerca (full-text italiano)" }),
	),
	categoryId: t.Optional(t.String({ description: "Filtra per ID categoria" })),
	lat: t.Optional(
		t.Number({
			minimum: -90,
			maximum: 90,
			description: "Latitudine del punto di ricerca",
		}),
	),
	lng: t.Optional(
		t.Number({
			minimum: -180,
			maximum: 180,
			description: "Longitudine del punto di ricerca",
		}),
	),
	radius: t.Optional(
		t.Number({
			default: 50,
			description: "Raggio di ricerca in km (default: 50)",
		}),
	),
});

/**
 * Pagination + optional text (name/comune) + category + geo for store discovery.
 * `radius` has NO default — geo without radius returns all stores nearest-first.
 */
export const StoreSearchQuery = t.Object({
	...PaginationQuery.properties,
	q: t.Optional(
		t.String({ description: "Testo di ricerca su nome negozio o comune" }),
	),
	categoryId: t.Optional(
		t.String({ description: "Filtra per ID categoria negozio" }),
	),
	lat: t.Optional(
		t.Number({ minimum: -90, maximum: 90, description: "Latitudine utente" }),
	),
	lng: t.Optional(
		t.Number({
			minimum: -180,
			maximum: 180,
			description: "Longitudine utente",
		}),
	),
	radius: t.Optional(
		t.Number({
			description: "Raggio in km (opzionale, nessun limite di default)",
		}),
	),
});

/**
 * Pagination + optional search/sort for category list endpoints.
 */
export const CategoryListQuery = t.Object({
	...PaginationQuery.properties,
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
