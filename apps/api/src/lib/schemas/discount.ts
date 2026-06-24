import { t } from "elysia";
import { PaginationQuery } from "@/lib/pagination";

export const DiscountStatusSchema = t.Union(
	[t.Literal("active"), t.Literal("paused"), t.Literal("archived")],
	{ description: "Stato persistito della promozione" },
);

export const DiscountOperationalStateSchema = t.Union(
	[t.Literal("assignable"), t.Literal("concluded")],
	{
		description:
			"Filtro lista: 'assignable' = in corso/programmate/in pausa; 'concluded' = scadute/archiviate",
	},
);

export const DiscountSchema = t.Object({
	id: t.String(),
	sellerProfileId: t.String(),
	title: t.String({ description: "Titolo della promozione" }),
	percent: t.Integer({
		minimum: 1,
		maximum: 99,
		description: "Percentuale di sconto (1-99)",
	}),
	startsAt: t.Date({ description: "Data di inizio" }),
	endsAt: t.Nullable(
		t.Date({ description: "Data di fine (null = senza scadenza)" }),
	),
	status: DiscountStatusSchema,
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const DiscountListItemSchema = t.Object({
	...DiscountSchema.properties,
	productCount: t.Integer({
		minimum: 0,
		description: "Numero di prodotti associati",
	}),
});

export const DiscountCreateBody = t.Object({
	title: t.String({
		minLength: 1,
		maxLength: 80,
		description: "Titolo della promozione",
	}),
	percent: t.Integer({ minimum: 1, maximum: 99 }),
	startsAt: t.Date(),
	endsAt: t.Optional(t.Nullable(t.Date())),
	initialProductIds: t.Optional(
		t.Array(t.String(), {
			maxItems: 100,
			description: "Prodotti da includere subito",
		}),
	),
});

export const DiscountUpdateBody = t.Object({
	title: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
	percent: t.Optional(t.Integer({ minimum: 1, maximum: 99 })),
	startsAt: t.Optional(t.Date()),
	endsAt: t.Optional(t.Nullable(t.Date())),
});

export const DiscountProductsBody = t.Object({
	productIds: t.Array(t.String(), { minItems: 1, maxItems: 100 }),
});

export const DiscountListQuery = t.Object({
	...PaginationQuery.properties,
	state: t.Optional(DiscountOperationalStateSchema),
	search: t.Optional(t.String({ maxLength: 80 })),
});

export const DiscountProductRowSchema = t.Object({
	id: t.String(),
	name: t.String(),
	originalPrice: t.String({ description: "Prezzo di listino" }),
	discountedPrice: t.String({ description: "Prezzo scontato (numeric.2)" }),
	brandId: t.Nullable(t.String()),
});

export const DiscountAddResultSchema = t.Object({
	added: t.Integer({ minimum: 0 }),
	alreadyPresent: t.Integer({ minimum: 0 }),
	rejected: t.Array(t.String(), {
		description: "IDs prodotto non associabili (cross-seller)",
	}),
});

export const DiscountRemoveResultSchema = t.Object({
	removed: t.Integer({ minimum: 0 }),
});
