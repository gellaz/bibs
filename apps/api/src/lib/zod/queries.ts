import { z } from "zod";
import { PaginationQuery } from "./pagination";

// Gemelli Zod di `lib/queries.ts` (D3 del piano Hono), nello stesso ordine e
// con gli stessi nomi; per ora solo quelli delle route migrate. In query
// `z.number()` e `z.boolean()` al primo livello hanno la coercizione di
// Elysia (`v()`, D5).

const d = (description: string) => ({ description });

/**
 * Pagination + optional search/sort for category list endpoints.
 */
export const CategoryListQuery = PaginationQuery.extend({
	search: z.string().max(100).meta(d("Ricerca testuale sul nome")).optional(),
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
