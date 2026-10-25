import { z } from "zod";
import {
	BrandSchema,
	ProductCategoryWithMacroSchema,
	ProductCharacteristicValueSchema,
	ProductImageSchema,
	ProductSchema,
	StoreProductSchema,
	StoreSchema,
} from "./entities";
import { zInteger } from "./t";

// Gemelli Zod di `lib/schemas/composed.ts` (D3 del piano Hono), nello stesso
// ordine e con gli stessi nomi.

// StoreProduct + store (location excluded — PostGIS EWKB fails in nested relational queries)
const StoreProductWithStore = StoreProductSchema.extend({
	store: StoreSchema.omit({ location: true }),
});

// Product with full relations (seller product list)
export const ProductWithRelationsSchema = ProductSchema.extend({
	productCategory: ProductCategoryWithMacroSchema.nullable(),
	storeProducts: z.array(StoreProductWithStore),
	images: z.array(ProductImageSchema),
	brand: BrandSchema.nullable(),
});

export const SellerProductDetailSchema = ProductWithRelationsSchema.extend({
	characteristicValues: z.array(ProductCharacteristicValueSchema).meta({
		description: "Valori compilati delle caratteristiche, ordinati per nome",
	}),
});

export const AppliedDiscountSchema = z.object({
	percent: zInteger({ minimum: 1, maximum: 99 }),
	discountedPrice: z
		.string()
		.meta({ description: "Prezzo scontato (numeric.2)" }),
	title: z.string(),
});

// Seller product list item = product with relations + the best running discount
// (null when none).
export const SellerProductListItemSchema = ProductWithRelationsSchema.extend({
	appliedDiscount: AppliedDiscountSchema.nullable(),
});
