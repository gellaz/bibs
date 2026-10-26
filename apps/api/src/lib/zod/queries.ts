import { z } from "zod";
import { orderStatuses, orderTypes } from "@/db/schemas/order";
import { PaginationQuery } from "./pagination";
import { zString } from "./t";

// Gemelli Zod di `lib/queries.ts` (D3 del piano Hono), nello stesso ordine e
// con gli stessi nomi; per ora solo quelli delle route migrate. In query
// `z.number()` e `z.boolean()` al primo livello hanno la coercizione di
// Elysia (`v()`, D5).

const d = (description: string) => ({ description });

/**
 * Pagination + optional status/type filters for order list endpoints.
 */
export const OrderListQuery = PaginationQuery.extend({
	status: z
		.enum(orderStatuses)
		.meta(d("Filtra per stato dell'ordine"))
		.optional(),
	type: z.enum(orderTypes).meta(d("Filtra per tipo di ordine")).optional(),
});

/**
 * Raggio di ricerca in km. Nessun default (senza raggio: tutti, dal più
 * vicino), ma limitato: i preset del customer arrivano a 10 km e la home a 50.
 */
const RadiusKm = z
	.number()
	.gt(0)
	.max(100)
	.meta(d("Raggio in km (opzionale, nessun limite di default; max 100)"));

/**
 * Paginazione + testo, categoria, geografia, prezzo e disponibilità per la
 * ricerca prodotti. `radius` **non ha default**, come `StoreSearchQuery`.
 */
export const ProductSearchQuery = PaginationQuery.extend({
	q: z.string().meta(d("Testo di ricerca (full-text italiano)")).optional(),
	categoryId: z.string().meta(d("Filtra per ID categoria prodotto")).optional(),
	macroCategoryId: z
		.string()
		.meta(
			d(
				"Filtra per ID macro categoria prodotto. Ignorato se `categoryId` è presente: la categoria è già dentro la sua macro.",
			),
		)
		.optional(),
	lat: z
		.number()
		.min(-90)
		.max(90)
		.meta(d("Latitudine del punto di ricerca"))
		.optional(),
	lng: z
		.number()
		.min(-180)
		.max(180)
		.meta(d("Longitudine del punto di ricerca"))
		.optional(),
	radius: RadiusKm.optional(),
	openNow: z
		.boolean()
		.meta(
			d(
				"Solo i prodotti disponibili in un negozio aperto in questo momento (fuso Europe/Rome). Restringe anche quale negozio viene agganciato al risultato.",
			),
		)
		.optional(),
	onSale: z
		.boolean()
		.meta(d("Solo i prodotti con uno sconto attivo in questo momento"))
		.optional(),
	minPrice: z
		.number()
		.min(0)
		.meta(d("Prezzo minimo in €, sul prezzo scontato"))
		.optional(),
	maxPrice: z
		.number()
		.min(0)
		.meta(d("Prezzo massimo in €, sul prezzo scontato"))
		.optional(),
});

/**
 * Pagination + optional text (name/comune) + category + geo for store discovery.
 * `radius` has NO default — geo without radius returns all stores nearest-first.
 */
export const StoreSearchQuery = PaginationQuery.extend({
	q: z.string().meta(d("Testo di ricerca su nome negozio o comune")).optional(),
	categoryId: z.string().meta(d("Filtra per ID categoria negozio")).optional(),
	macroCategoryId: z
		.string()
		.meta(
			d(
				"Filtra per ID macro categoria negozio. Ignorato se `categoryId` è presente: la categoria è già dentro la sua macro.",
			),
		)
		.optional(),
	lat: z.number().min(-90).max(90).meta(d("Latitudine utente")).optional(),
	lng: z.number().min(-180).max(180).meta(d("Longitudine utente")).optional(),
	radius: RadiusKm.optional(),
	openNow: z
		.boolean()
		.meta(
			d(
				"Restituisce solo i negozi aperti in questo momento (fuso Europe/Rome), tenendo conto di orari, chiusure personalizzate e festività.",
			),
		)
		.optional(),
});

/**
 * Pagination + optional search/sort for category list endpoints.
 */
export const CategoryListQuery = PaginationQuery.extend({
	search: zString({
		maxLength: 100,
		description: "Ricerca testuale sul nome",
	}).optional(),
	sortBy: z
		.enum(["name", "createdAt"])
		.default("name")
		.meta(d("Campo di ordinamento"))
		.optional(),
	sortOrder: z
		.enum(["asc", "desc"])
		.default("asc")
		.meta(d("Direzione di ordinamento"))
		.optional(),
});

/**
 * Pagination + optional search/sort/dataType filter for characteristic list
 * endpoints.
 */
export const CharacteristicListQuery = CategoryListQuery.extend({
	dataType: z
		.enum(["text", "number", "boolean", "enum"])
		.meta(d("Filtra per tipo di dato"))
		.optional(),
});

/**
 * Pagination + optional search/sort/macroCategoryId filter for product
 * category list endpoints (public and admin).
 */
export const ProductCategoryListQuery = CategoryListQuery.extend({
	macroCategoryId: z
		.string()
		.meta(d("Filtra per ID della macro categoria"))
		.optional(),
});

/**
 * Negozio, lat/lng opzionali per la scheda prodotto customer: `storeId`
 * indica il negozio da cui arriva il cliente, lat/lng scelgono il più vicino
 * fra quelli idonei quando quello richiesto non c'è (o non è indicato).
 */
export const ProductDetailQuery = z.object({
	storeId: z
		.string()
		.meta(
			d(
				"Negozio da cui arriva il cliente: viene agganciato se ha il prodotto disponibile",
			),
		)
		.optional(),
	lat: z
		.number()
		.min(-90)
		.max(90)
		.meta(d("Latitudine dell'origine, per scegliere il negozio più vicino"))
		.optional(),
	lng: z
		.number()
		.min(-180)
		.max(180)
		.meta(d("Longitudine dell'origine, per scegliere il negozio più vicino"))
		.optional(),
});
