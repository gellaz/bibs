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
 * Paginazione + testo, categoria, geografia, prezzo e disponibilità per la
 * ricerca prodotti. `radius` **non ha default**, come `StoreSearchQuery`: geo
 * senza raggio ordina per vicinanza senza tagliare nulla. Chi vuole un limite
 * lo dichiara (la home lo fa).
 */
export const ProductSearchQuery = t.Object({
	...PaginationQuery.properties,
	q: t.Optional(
		t.String({ description: "Testo di ricerca (full-text italiano)" }),
	),
	categoryId: t.Optional(
		t.String({ description: "Filtra per ID categoria prodotto" }),
	),
	macroCategoryId: t.Optional(
		t.String({
			description:
				"Filtra per ID macro categoria prodotto. Ignorato se `categoryId` è presente: la categoria è già dentro la sua macro.",
		}),
	),
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
			description: "Raggio in km (opzionale, nessun limite di default)",
		}),
	),
	openNow: t.Optional(
		t.Boolean({
			description:
				"Solo i prodotti disponibili in un negozio aperto in questo momento (fuso Europe/Rome). Restringe anche quale negozio viene agganciato al risultato.",
		}),
	),
	onSale: t.Optional(
		t.Boolean({
			description: "Solo i prodotti con uno sconto attivo in questo momento",
		}),
	),
	minPrice: t.Optional(
		t.Number({
			minimum: 0,
			description: "Prezzo minimo in €, sul prezzo scontato",
		}),
	),
	maxPrice: t.Optional(
		t.Number({
			minimum: 0,
			description: "Prezzo massimo in €, sul prezzo scontato",
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
	macroCategoryId: t.Optional(
		t.String({
			description:
				"Filtra per ID macro categoria negozio. Ignorato se `categoryId` è presente: la categoria è già dentro la sua macro.",
		}),
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
	openNow: t.Optional(
		t.Boolean({
			description:
				"Restituisce solo i negozi aperti in questo momento (fuso Europe/Rome), tenendo conto di orari, chiusure personalizzate e festività.",
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

/**
 * Pagination + optional search/sort/dataType filter for characteristic list
 * endpoints.
 */
export const CharacteristicListQuery = t.Object({
	...CategoryListQuery.properties,
	dataType: t.Optional(
		t.Union(
			[
				t.Literal("text"),
				t.Literal("number"),
				t.Literal("boolean"),
				t.Literal("enum"),
			],
			{ description: "Filtra per tipo di dato" },
		),
	),
});

/**
 * Pagination + optional search/sort/macroCategoryId filter for product
 * category list endpoints (public and admin).
 */
export const ProductCategoryListQuery = t.Object({
	...CategoryListQuery.properties,
	macroCategoryId: t.Optional(
		t.String({ description: "Filtra per ID della macro categoria" }),
	),
});
