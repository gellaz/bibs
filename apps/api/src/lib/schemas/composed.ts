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
	ProductCategorySchema,
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

// ────────────────────────────────────────────
// Composed schemas (nested relations)
// ────────────────────────────────────────────

// Store + phone numbers + category + images
export const StoreWithPhonesSchema = t.Object({
	...StoreSchema.properties,
	phoneNumbers: t.Array(StorePhoneNumberSchema),
	category: t.Nullable(StoreCategorySchema),
	images: t.Array(StoreImageSchema),
});

// Seller profile + user + organization (admin pending list)
export const SellerProfileWithUserSchema = t.Object({
	...SellerProfileSchema.properties,
	user: UserSchema,
	organization: t.Nullable(OrganizationSchema),
});

// Employee + user
export const EmployeeWithUserSchema = t.Object({
	...EmployeeSchema.properties,
	user: UserSchema,
	storeIds: t.Array(t.String(), {
		description: "ID dei negozi a cui il dipendente è assegnato",
	}),
});

// Product category assignment with category
const ProductCategoryAssignmentWithCategory = t.Object({
	productId: t.String(),
	productCategoryId: t.String(),
	category: ProductCategorySchema,
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

// OrderItem + storeProduct with product
const OrderItemWithProduct = t.Object({
	...OrderItemSchema.properties,
	storeProduct: StoreProductWithProduct,
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
