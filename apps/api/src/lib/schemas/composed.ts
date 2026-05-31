import { t } from "elysia";
import {
	BrandSchema,
	CustomerAddressSchema,
	CustomerProfileSchema,
	EmployeeSchema,
	OrderItemSchema,
	OrderSchema,
	OrganizationSchema,
	PaymentMethodSchema,
	ProductCategoryWithMacroSchema,
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
} from "./entities";
import { OpenStatusSchema } from "./holidays";

// ────────────────────────────────────────────
// Composed schemas (nested relations)
// ────────────────────────────────────────────

// Store + phone numbers + category + images
export const StoreWithPhonesSchema = t.Object({
	...StoreSchema.properties,
	phoneNumbers: t.Array(StorePhoneNumberSchema),
	category: t.Nullable(StoreCategorySchema),
	images: t.Array(StoreImageSchema),
	openStatus: t.Optional(t.Nullable(OpenStatusSchema)),
});

// Seller profile + user + organization (admin pending list)
export const SellerProfileWithUserSchema = t.Object({
	...SellerProfileSchema.properties,
	user: UserSchema,
	organization: t.Nullable(OrganizationSchema),
});

// ── Auth: registration / sign-in success payloads ──────────
// These endpoints return RAW DB rows: seller profiles without the joined
// municipality objects, and organizations without the joined municipality.
const RawSellerProfileSchema = t.Omit(SellerProfileSchema, [
	"residenceMunicipality",
	"documentIssuedMunicipality",
]);
const RawOrganizationSchema = t.Omit(OrganizationSchema, ["municipality"]);

// `token` may be absent/null when email verification is required (no session).
const AuthToken = t.Optional(t.Nullable(t.String()));

export const RegisterCustomerResult = t.Object({
	user: UserSchema,
	profile: CustomerProfileSchema,
	token: AuthToken,
});

export const RegisterSellerResult = t.Object({
	user: UserSchema,
	profile: RawSellerProfileSchema,
	token: AuthToken,
});

export const SignInResult = t.Object({
	user: UserSchema,
	profiles: t.Object({
		customer: t.Nullable(CustomerProfileSchema),
		seller: t.Nullable(RawSellerProfileSchema),
	}),
	organization: t.Nullable(RawOrganizationSchema),
	token: AuthToken,
});

// Employee + user
export const EmployeeWithUserSchema = t.Object({
	...EmployeeSchema.properties,
	user: UserSchema,
	storeIds: t.Array(t.String(), {
		description: "ID dei negozi a cui il dipendente è assegnato",
	}),
});

// Product category assignment with category (includes parent macro)
const ProductCategoryAssignmentWithCategory = t.Object({
	productId: t.String(),
	productCategoryId: t.String(),
	category: ProductCategoryWithMacroSchema,
});

// StoreProduct + store (location excluded — PostGIS EWKB fails in nested relational queries)
const StoreProductWithStore = t.Object({
	...StoreProductSchema.properties,
	store: t.Omit(StoreSchema, ["location"]),
});

// Product with full relations (seller product list)
export const ProductWithRelationsSchema = t.Object({
	...ProductSchema.properties,
	productCategoryAssignments: t.Array(ProductCategoryAssignmentWithCategory),
	storeProducts: t.Array(StoreProductWithStore),
	images: t.Array(ProductImageSchema),
	brand: t.Nullable(BrandSchema),
});

// StoreProduct + product (for order items)
const StoreProductWithProduct = t.Object({
	...StoreProductSchema.properties,
	product: ProductSchema,
});

// OrderItem + storeProduct with product (storeProduct nullable: FK is set null on hard delete)
const OrderItemWithProduct = t.Object({
	...OrderItemSchema.properties,
	storeProduct: t.Nullable(StoreProductWithProduct),
});

// CustomerProfile + user (seller order view)
const CustomerProfileWithUser = t.Object({
	...CustomerProfileSchema.properties,
	user: UserSchema,
});

// Order with relations — seller view
export const SellerOrderWithRelationsSchema = t.Object({
	...OrderSchema.properties,
	items: t.Array(OrderItemWithProduct),
	customerProfile: CustomerProfileWithUser,
	store: StoreSchema,
});

// Order with relations — customer view
export const CustomerOrderWithRelationsSchema = t.Object({
	...OrderSchema.properties,
	items: t.Array(OrderItemWithProduct),
	store: StoreSchema,
	shippingAddress: t.Nullable(CustomerAddressSchema),
});

// Seller settings (profile + org + payment + pending changes)
export const SellerSettingsSchema = t.Object({
	profile: SellerProfileSchema,
	organization: t.Nullable(OrganizationSchema),
	paymentMethod: t.Nullable(PaymentMethodSchema),
	pendingChanges: t.Array(SellerProfileChangeSchema),
	assignedStoreIds: t.Union([t.Array(t.String()), t.Null()], {
		description:
			"Lista storeId assegnati all'employee, o null se owner (= tutti)",
	}),
});

// Change request with seller profile + user (admin view)
export const SellerProfileChangeWithSellerSchema = t.Object({
	...SellerProfileChangeSchema.properties,
	sellerProfile: t.Object({
		...SellerProfileSchema.properties,
		user: UserSchema,
		organization: t.Nullable(OrganizationSchema),
	}),
});
