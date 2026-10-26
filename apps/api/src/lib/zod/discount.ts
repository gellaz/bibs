import { z } from "zod";
import { PaginationQuery } from "./pagination";
import { zDate, zInteger } from "./t";

// Gemelli Zod di `lib/schemas/discount.ts` (D3 del piano Hono), stessi nomi e
// stesso ordine. `DiscountCreateBody` e `DiscountListQuery` vengono da
// `tests/http/parity-cases.ts` (U1), dove restano i loro casi di parità.

export const DiscountStatusSchema = z
	.enum(["active", "paused", "archived"])
	.meta({ description: "Stato persistito della promozione" });

export const DiscountOperationalStateSchema = z
	.enum(["assignable", "concluded"])
	.meta({
		description:
			"Filtro lista: 'assignable' = in corso/programmate/in pausa; 'concluded' = scadute/archiviate",
	});

export const DiscountSchema = z.object({
	id: z.string(),
	sellerProfileId: z.string(),
	title: z.string().meta({ description: "Titolo della promozione" }),
	percent: zInteger({
		minimum: 1,
		maximum: 99,
		description: "Percentuale di sconto (1-99)",
	}),
	startsAt: zDate({ description: "Data di inizio" }),
	endsAt: zDate({
		description: "Data di fine (null = senza scadenza)",
	}).nullable(),
	status: DiscountStatusSchema,
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const DiscountListItemSchema = DiscountSchema.extend({
	productCount: zInteger({
		minimum: 0,
		description: "Numero di prodotti associati",
	}),
});

export const DiscountCreateBody = z.object({
	title: z
		.string()
		.min(1)
		.max(80)
		.meta({ description: "Titolo della promozione" }),
	percent: zInteger({ minimum: 1, maximum: 99 }),
	startsAt: zDate(),
	endsAt: zDate().nullable().optional(),
	initialProductIds: z
		.array(z.string())
		.max(100)
		.meta({ description: "Prodotti da includere subito" })
		.optional(),
});

export const DiscountUpdateBody = z.object({
	title: z.string().min(1).max(80).optional(),
	percent: zInteger({ minimum: 1, maximum: 99 }).optional(),
	startsAt: zDate().optional(),
	endsAt: zDate().nullable().optional(),
});

export const DiscountProductsBody = z.object({
	productIds: z.array(z.string()).min(1).max(100),
});

export const DiscountListQuery = PaginationQuery.extend({
	state: DiscountOperationalStateSchema.optional(),
	search: z.string().max(80).optional(),
});

export const DiscountProductRowSchema = z.object({
	id: z.string(),
	name: z.string(),
	originalPrice: z.string().meta({ description: "Prezzo di listino" }),
	discountedPrice: z
		.string()
		.meta({ description: "Prezzo scontato (numeric.2)" }),
	brandId: z.string().nullable(),
});

export const DiscountAddResultSchema = z.object({
	added: zInteger({ minimum: 0 }),
	alreadyPresent: zInteger({ minimum: 0 }),
	rejected: z
		.array(z.string())
		.meta({ description: "IDs prodotto non associabili (cross-seller)" }),
});

export const DiscountRemoveResultSchema = z.object({
	removed: zInteger({ minimum: 0 }),
});
