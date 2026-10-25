import { z } from "zod";
import {
	CustomerAddressSchema,
	OrderItemSchema,
	OrderSchema,
	ProductSchema,
	StoreProductSchema,
	StoreSchema,
} from "./entities";
import { OpenStatusSchema } from "./holidays";
import { zDate } from "./t";

// Gemelli Zod di `lib/schemas/composed.ts` (D3 del piano Hono), nello stesso
// ordine e con gli stessi nomi; per ora solo quelli delle route migrate.

const d = (description: string) => ({ description });

const StoreProductWithProduct = z.object({
	...StoreProductSchema.shape,
	product: ProductSchema,
});

// OrderItem + storeProduct with product (storeProduct nullable: FK is set null on hard delete)
const OrderItemWithProduct = z.object({
	...OrderItemSchema.shape,
	storeProduct: StoreProductWithProduct.nullable(),
});

// Order with relations — customer view
export const CustomerOrderWithRelationsSchema = z.object({
	...OrderSchema.shape,
	items: z.array(OrderItemWithProduct),
	// location esclusa: la geometria PostGIS non si legge nelle relazioni annidate.
	store: z.object({
		...StoreSchema.omit({ location: true }).shape,
		openStatus: OpenStatusSchema.nullable()
			.meta(
				d(
					"Stato di apertura adesso: nel dettaglio ordine e nel checkout, non nella lista",
				),
			)
			.optional(),
	}),
	shippingAddress: CustomerAddressSchema.nullable(),
});

// Checkout — conferma del cliente con gli ordini che ha prodotto
export const CheckoutSchema = z.object({
	id: z.string(),
	createdAt: zDate(),
	amountDueOnline: z
		.string()
		.meta(d("Importo da pagare online (somma degli ordini Paga e ritira)")),
	payment: z
		.object({
			clientSecret: z.string().meta(d("Per il Payment Element di Stripe")),
		})
		.meta(
			d(
				"Presente finché c'è un ordine Paga e ritira in attesa di pagamento e il pagamento è ancora possibile",
			),
		)
		.nullable(),
	orders: z.array(CustomerOrderWithRelationsSchema),
});

export const CheckoutPreviewSchema = z.object({
	balance: z.number().min(0).meta(d("Saldo punti del cliente")),
	minAmountOnline: z
		.string()
		.meta(
			d("Minimo incassabile online (limite Stripe in EUR): sotto, solo 0 €"),
		),
	payInStore: z
		.string()
		.meta(d("Somma degli ordini Prenota e paga in negozio")),
	withoutPoints: z.object({
		amountDueOnline: z.string().meta(d("Da pagare online senza punti")),
		belowMinimum: z
			.boolean()
			.meta(
				d(
					"Importo online tra 0,01 € e minAmountOnline: senza punti la conferma risponde 400",
				),
			),
	}),
	withPoints: z
		.object({
			pointsSpent: z.number().min(0),
			discount: z.string().meta(d("Sconto punti totale in euro")),
			amountDueOnline: z
				.string()
				.meta(d("Da pagare online con i punti: 0 oppure almeno 0,50")),
			perStore: z.array(
				z.object({
					storeId: z.string(),
					pointsSpent: z.number().min(0),
					discount: z.string(),
				}),
			),
		})
		.meta(
			d("Null se non ci sono ordini Paga e ritira o i punti non danno sconto"),
		)
		.nullable(),
});

// ── Customer: facet di ricerca negozi (sidebar filtri) ─────
const StoreCategoryFacetSchema = z.object({
	id: z.string(),
	name: z.string().meta(d("Nome della categoria negozio")),
	storeCount: z
		.number()
		.meta(d("Negozi che restano applicando questa categoria")),
});

export const StoreFacetsSchema = z.object({
	total: z
		.number()
		.meta(d("Negozi che corrispondono a testo e raggio, senza categoria")),
	openNowTotal: z
		.number()
		.meta(
			d("Negozi aperti adesso fra quelli che corrispondono a testo e raggio"),
		),
	macros: z.array(
		z.object({
			id: z.string(),
			name: z.string().meta(d("Nome della macro categoria")),
			storeCount: z
				.number()
				.meta(d("Negozi che restano applicando questa macro")),
			categories: z.array(StoreCategoryFacetSchema),
		}),
	),
});
