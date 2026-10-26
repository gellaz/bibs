import { z } from "zod";
import {
	BrandSchema,
	CustomerAddressSchema,
	CustomerProfileSchema,
	EmployeeSchema,
	OnlinePaymentsSchema,
	OrderItemSchema,
	OrderSchema,
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
import { zDate, zInteger } from "./t";

// Gemelli Zod di `lib/schemas/composed.ts` (D3 del piano Hono), stessi nomi e
// stesso ordine; si aggiungono quando una route migrata li usa.

const d = (description: string) => ({ description });

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

// Seller profile + user + organization (admin pending list)
export const SellerProfileWithUserSchema = SellerProfileSchema.extend({
	updatedAt: zDate({
		description:
			"Versione della candidatura: da rimandare in verify/reject come expectedUpdatedAt",
	}),
	user: UserSchema,
	organization: OrganizationSchema.nullable(),
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

// Change request with seller profile + user (admin view)
export const SellerProfileChangeWithSellerSchema =
	SellerProfileChangeSchema.extend({
		sellerProfile: SellerProfileSchema.extend({
			user: UserSchema,
			organization: OrganizationSchema.nullable(),
		}),
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

const subscriptionStatus = () =>
	z.enum(["active", "past_due", "canceling", "suspended", "canceled"]);

export const AdminStoreListItemSchema = z
	.object({
		id: z.string().meta(d("ID del negozio")),
		name: z.string().meta(d("Nome del negozio")),
		sellerProfileId: z.string().meta(d("ID del profilo venditore titolare")),
		businessName: z
			.string()
			.meta(d("Ragione sociale del venditore"))
			.nullable(),
		categoryName: z.string().meta(d("Categoria del negozio")).nullable(),
		municipality: z.object({
			name: z.string().meta(d("Nome del comune")),
			provinceAcronym: z.string().meta(d("Sigla della provincia")),
		}),
		subscriptionStatus: subscriptionStatus()
			.meta(d("Stato dell'abbonamento; null se mai sottoscritto"))
			.nullable(),
		createdAt: zDate({ description: "Data di creazione" }),
		deletedAt: zDate({ description: "Data di eliminazione" }).nullable(),
	})
	.meta(
		d(
			"Negozio nella lista admin, con venditore, comune e stato dell'abbonamento",
		),
	);

// ── Admin: pagina «Richieste» ──────────────
export const AdminRequestRowSchema = z.object({
	kind: z.enum(["candidature", "vat", "document"]),
	id: z
		.string()
		.meta(d("ID della richiesta; per le candidature il sellerProfileId")),
	sellerProfileId: z.string(),
	seller: z.object({ name: z.string().nullable(), email: z.string() }),
	businessName: z.string().nullable(),
	currentValue: z.string().nullable(),
	requestedValue: z.string().nullable(),
	submittedAt: zDate(),
});

const DocumentSnapshotSchema = z.object({
	documentType: z
		.enum(["identity_card", "driving_license", "passport"])
		.nullable(),
	documentNumber: z.string().nullable(),
	documentExpiry: z.string().nullable(),
	issuedMunicipality: z
		.object({ name: z.string(), provinceAcronym: z.string() })
		.nullable(),
	imageUrl: z.string().nullable(),
});

export const AdminChangeDetailSchema = z.object({
	id: z.string(),
	changeType: z.enum(["vat", "document"]),
	status: z.enum(["pending", "approved", "rejected", "cancelled"]),
	createdAt: zDate(),
	seller: z.object({
		id: z.string(),
		name: z.string().nullable(),
		email: z.string(),
		businessName: z.string().nullable(),
	}),
	vat: z
		.object({ current: z.string().nullable(), requested: z.string() })
		.nullable(),
	document: z
		.object({
			current: DocumentSnapshotSchema,
			requested: DocumentSnapshotSchema,
		})
		.nullable(),
});
