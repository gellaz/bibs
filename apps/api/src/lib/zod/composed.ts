import { z } from "zod";
import {
	BrandSchema,
	CustomerProfileSchema,
	EmployeeSchema,
	OnlinePaymentsSchema,
	OrganizationSchema,
	ProductCategoryWithMacroSchema,
	ProductCharacteristicValueSchema,
	ProductImageSchema,
	ProductSchema,
	SellerProfileChangeSchema,
	SellerProfileSchema,
	StoreCategorySchema,
	StoreImageSchema,
	StorePhoneNumberSchema,
	StoreProductSchema,
	StoreSchema,
	UserSchema,
	UserSummarySchema,
} from "./entities";
import { OpenStatusSchema } from "./holidays";
import { zInteger } from "./t";

// Gemelli Zod di `lib/schemas/composed.ts` (D3 del piano Hono), stessi nomi e
// stesso ordine; si aggiungono quando una route migrata li usa.

// Store + phone numbers + category + images
export const StoreWithPhonesSchema = StoreSchema.extend({
	lowStockThreshold: zInteger({
		minimum: 0,
		description:
			"Soglia di scorta bassa del negozio (0 = avviso spento). Solo lato venditore",
	}),
	reservationHours: zInteger({
		description:
			"Ore di apertura entro cui ritirare una prenotazione. Solo lato venditore",
	}),
	phoneNumbers: z.array(StorePhoneNumberSchema),
	category: StoreCategorySchema.nullable(),
	images: z.array(StoreImageSchema),
	openStatus: OpenStatusSchema.nullable().optional(),
});

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

// Employee + user
export const EmployeeWithUserSchema = EmployeeSchema.extend({
	user: UserSummarySchema,
	storeIds: z.array(z.string()).meta({
		description: "ID dei negozi a cui il dipendente è assegnato",
	}),
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

// Seller settings (profile + org + online payments + pending changes)
export const SellerSettingsSchema = z.object({
	profile: SellerProfileSchema,
	organization: OrganizationSchema.nullable(),
	onlinePayments: OnlinePaymentsSchema.nullable(),
	pendingChanges: z.array(SellerProfileChangeSchema),
	assignedStoreIds: z.union([z.array(z.string()), z.null()]).meta({
		description:
			"Lista storeId assegnati all'employee, o null se owner (= tutti)",
	}),
});
