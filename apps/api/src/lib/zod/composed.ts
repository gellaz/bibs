import { z } from "zod";
import {
	BrandSchema,
	CustomerProfileSchema,
	OrderItemSchema,
	OrderSchema,
	OrganizationSchema,
	ProductCategoryWithMacroSchema,
	ProductCharacteristicValueSchema,
	ProductImageSchema,
	ProductSchema,
	SellerProfileSchema,
	StoreProductSchema,
	StoreSchema,
	UserSchema,
	UserSummarySchema,
} from "./entities";
import { zInteger } from "./t";

// Gemelli Zod di `lib/schemas/composed.ts` (D3 del piano Hono), stessi nomi e
// stesso ordine; si aggiungono quando una route migrata li usa.

// ── Auth: registration / sign-in success payloads ──────────
// These endpoints return RAW DB rows: seller profiles without the joined
// municipality objects, and organizations without the joined municipality.
const RawSellerProfileSchema = SellerProfileSchema.omit({
	residenceMunicipality: true,
	documentIssuedMunicipality: true,
});
const RawOrganizationSchema = OrganizationSchema.omit({ municipality: true });

// `token` may be absent/null when email verification is required (no session).
const AuthToken = z.string().nullable().optional();

export const RegisterCustomerResult = z.object({
	user: UserSchema,
	profile: CustomerProfileSchema,
	token: AuthToken,
});

export const RegisterSellerResult = z.object({
	user: UserSchema,
	profile: RawSellerProfileSchema,
	token: AuthToken,
});

export const SignInResult = z.object({
	user: UserSchema,
	profiles: z.object({
		customer: CustomerProfileSchema.nullable(),
		seller: RawSellerProfileSchema.nullable(),
	}),
	organization: RawOrganizationSchema.nullable(),
	token: AuthToken,
});

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

// StoreProduct + product (for order items)
const StoreProductWithProduct = StoreProductSchema.extend({
	product: ProductSchema,
});

// OrderItem + storeProduct with product (storeProduct nullable: FK is set null on hard delete)
const OrderItemWithProduct = OrderItemSchema.extend({
	storeProduct: StoreProductWithProduct.nullable(),
});

// Cliente visto dal seller sull'ordine: niente saldo punti né dati di account
const SellerOrderCustomer = z.object({
	id: z.string(),
	user: UserSummarySchema,
});

// Order with relations — seller view
export const SellerOrderWithRelationsSchema = OrderSchema.extend({
	items: z.array(OrderItemWithProduct),
	customerProfile: SellerOrderCustomer,
	// location esclusa: la geometria PostGIS non si legge nelle relazioni annidate.
	store: StoreSchema.omit({ location: true }),
});
