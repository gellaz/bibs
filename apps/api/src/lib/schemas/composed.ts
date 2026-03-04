import { t } from "elysia";
import {
	CategorySchema,
	CustomerAddressSchema,
	CustomerProfileSchema,
	EmployeeSchema,
	OrderItemSchema,
	OrderSchema,
	OrganizationSchema,
	ProductImageSchema,
	ProductSchema,
	SellerProfileSchema,
	StorePhoneNumberSchema,
	StoreProductSchema,
	StoreSchema,
	UserSchema,
} from "./entities";

// ────────────────────────────────────────────
// Composed schemas (nested relations)
// ────────────────────────────────────────────

// Store + phone numbers
export const StoreWithPhonesSchema = t.Object({
	...StoreSchema.properties,
	phoneNumbers: t.Array(StorePhoneNumberSchema),
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
});

// Product classification with category
const ProductClassificationWithCategory = t.Object({
	productId: t.String(),
	productCategoryId: t.String(),
	category: CategorySchema,
});

// StoreProduct + store
const StoreProductWithStore = t.Object({
	...StoreProductSchema.properties,
	store: StoreSchema,
});

// Product with full relations (seller product list)
export const ProductWithRelationsSchema = t.Object({
	...ProductSchema.properties,
	productClassifications: t.Array(ProductClassificationWithCategory),
	storeProducts: t.Array(StoreProductWithStore),
	images: t.Array(ProductImageSchema),
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
