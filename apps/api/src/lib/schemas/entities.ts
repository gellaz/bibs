import { t } from "elysia";

// ────────────────────────────────────────────
// Shared types
// ────────────────────────────────────────────

const PointXY = t.Object({
	x: t.Number({ description: "Longitudine" }),
	y: t.Number({ description: "Latitudine" }),
});

// ────────────────────────────────────────────
// Reusable body field groups (for route input schemas)
// ────────────────────────────────────────────

export const LocationField = t.Optional(
	t.Object(
		{
			x: t.Number({ description: "Longitudine" }),
			y: t.Number({ description: "Latitudine" }),
		},
		{ description: "Coordinate geografiche (PostGIS point)" },
	),
);

/** Required address fields for create operations. */
export const AddressFieldsRequired = {
	addressLine1: t.String({
		minLength: 1,
		maxLength: 200,
		description: "Indirizzo (riga 1)",
	}),
	addressLine2: t.Optional(
		t.String({ maxLength: 200, description: "Indirizzo (riga 2)" }),
	),
	city: t.String({ minLength: 1, maxLength: 100, description: "Città" }),
	zipCode: t.String({
		pattern: "^\\d{5}$",
		description: "CAP italiano (5 cifre)",
	}),
	province: t.Optional(
		t.String({ minLength: 2, maxLength: 5, description: "Provincia (sigla)" }),
	),
	country: t.Optional(
		t.String({
			minLength: 2,
			maxLength: 2,
			description: "Codice paese ISO 3166-1 alpha-2 (default: IT)",
		}),
	),
	location: LocationField,
} as const;

/** Optional address fields for update/patch operations. */
export const AddressFieldsOptional = {
	addressLine1: t.Optional(
		t.String({
			minLength: 1,
			maxLength: 200,
			description: "Indirizzo (riga 1)",
		}),
	),
	addressLine2: t.Optional(
		t.String({ maxLength: 200, description: "Indirizzo (riga 2)" }),
	),
	city: t.Optional(
		t.String({ minLength: 1, maxLength: 100, description: "Città" }),
	),
	zipCode: t.Optional(
		t.String({ pattern: "^\\d{5}$", description: "CAP italiano (5 cifre)" }),
	),
	province: t.Optional(
		t.String({ minLength: 2, maxLength: 5, description: "Provincia (sigla)" }),
	),
	country: t.Optional(
		t.String({ minLength: 2, maxLength: 2, description: "Codice paese" }),
	),
	location: LocationField,
} as const;

// ────────────────────────────────────────────
// Entity schemas
// ────────────────────────────────────────────

export const UserSchema = t.Object({
	id: t.String(),
	name: t.String(),
	email: t.String(),
	emailVerified: t.Boolean(),
	image: t.Nullable(t.String()),
	createdAt: t.Date(),
	updatedAt: t.Date(),
	role: t.Nullable(t.String()),
	banned: t.Nullable(t.Boolean()),
	banReason: t.Nullable(t.String()),
	banExpires: t.Nullable(t.Date()),
});

export const CategorySchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome della categoria prodotto" }),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const SellerProfileSchema = t.Object({
	id: t.String(),
	userId: t.String(),
	onboardingStatus: t.Union(
		[
			t.Literal("pending_email"),
			t.Literal("pending_personal"),
			t.Literal("pending_document"),
			t.Literal("pending_company"),
			t.Literal("pending_store"),
			t.Literal("pending_payment"),
			t.Literal("pending_review"),
			t.Literal("active"),
			t.Literal("rejected"),
		],
		{ description: "Stato dell'onboarding del venditore" },
	),
	firstName: t.Nullable(t.String()),
	lastName: t.Nullable(t.String()),
	citizenship: t.Nullable(t.String()),
	birthCountry: t.Nullable(t.String()),
	birthDate: t.Nullable(
		t.String({ description: "Data di nascita (YYYY-MM-DD)" }),
	),
	residenceCountry: t.Nullable(t.String()),
	residenceCity: t.Nullable(t.String()),
	residenceAddress: t.Nullable(t.String()),
	residenceZipCode: t.Nullable(t.String()),
	documentNumber: t.Nullable(t.String()),
	documentExpiry: t.Nullable(
		t.String({ description: "Scadenza documento (YYYY-MM-DD)" }),
	),
	documentIssuedMunicipality: t.Nullable(t.String()),
	documentImageUrl: t.Nullable(t.String()),
	createdAt: t.Date(),
});

export const OrganizationSchema = t.Object({
	id: t.String(),
	sellerProfileId: t.String(),
	businessName: t.String({ description: "Ragione sociale" }),
	vatNumber: t.String({ description: "Partita IVA" }),
	legalForm: t.String({ description: "Forma giuridica" }),
	addressLine1: t.String({ description: "Indirizzo sede legale" }),
	country: t.String({ description: "Codice paese ISO 3166-1 alpha-2" }),
	province: t.Nullable(t.String({ description: "Provincia" })),
	city: t.String({ description: "Città" }),
	zipCode: t.String({ description: "CAP" }),
	vatStatus: t.Union(
		[t.Literal("pending"), t.Literal("verified"), t.Literal("rejected")],
		{ description: "Stato di verifica della partita IVA" },
	),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const StoreCategorySchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome della categoria negozio" }),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const StoreImageSchema = t.Object({
	id: t.String(),
	storeId: t.String(),
	url: t.String({ description: "URL pubblico dell'immagine" }),
	key: t.String({ description: "Chiave S3/MinIO" }),
	position: t.Number({ minimum: 0, description: "Posizione di ordinamento" }),
	createdAt: t.Date(),
});

export const PaymentMethodSchema = t.Object({
	id: t.String(),
	sellerProfileId: t.String(),
	stripeAccountId: t.Nullable(
		t.String({ description: "ID account Stripe Connect" }),
	),
	isDefault: t.Boolean(),
	createdAt: t.Date(),
});

export const StoreSchema = t.Object({
	id: t.String(),
	sellerProfileId: t.String(),
	name: t.String({ description: "Nome del negozio" }),
	description: t.Nullable(t.String({ description: "Descrizione del negozio" })),
	addressLine1: t.String({ description: "Indirizzo (riga 1)" }),
	addressLine2: t.Nullable(t.String({ description: "Indirizzo (riga 2)" })),
	city: t.String({ description: "Città" }),
	zipCode: t.String({ description: "CAP" }),
	province: t.Nullable(t.String({ description: "Provincia (sigla)" })),
	country: t.String({ description: "Codice paese ISO 3166-1 alpha-2" }),
	location: t.Nullable(PointXY),
	categoryId: t.Nullable(t.String({ description: "ID categoria negozio" })),
	openingHours: t.Nullable(
		t.Unknown({ description: "Orari di apertura (JSON)" }),
	),
	websiteUrl: t.Nullable(t.String({ description: "URL del sito web" })),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const ProductSchema = t.Object({
	id: t.String(),
	sellerProfileId: t.String(),
	name: t.String(),
	description: t.Nullable(t.String()),
	price: t.String({ description: "Prezzo in formato decimale (es. '9.99')" }),
	isActive: t.Boolean({ description: "Se il prodotto è attivo e visibile" }),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const ProductImageSchema = t.Object({
	id: t.String(),
	productId: t.String(),
	url: t.String({ description: "URL pubblico dell'immagine" }),
	key: t.String({ description: "Chiave S3/MinIO" }),
	position: t.Number({ minimum: 0, description: "Posizione di ordinamento" }),
	createdAt: t.Date(),
});

export const StorePhoneNumberSchema = t.Object({
	id: t.String(),
	storeId: t.String(),
	label: t.Nullable(
		t.String({ description: "Etichetta (es. 'Principale', 'WhatsApp')" }),
	),
	number: t.String({ description: "Numero di telefono" }),
	position: t.Number({ minimum: 0, description: "Posizione di ordinamento" }),
	createdAt: t.Date(),
});

export const CsvImportResultSchema = t.Object({
	created: t.Number({ description: "Numero di prodotti creati con successo" }),
	failed: t.Number({ description: "Numero di righe con errori" }),
	errors: t.Array(
		t.Object({
			row: t.Number({ description: "Numero di riga nel CSV (partendo da 2)" }),
			message: t.String({ description: "Descrizione dell'errore" }),
		}),
	),
});

export const StoreProductSchema = t.Object({
	id: t.String(),
	productId: t.String(),
	storeId: t.String(),
	stock: t.Number({
		minimum: 0,
		description: "Quantità disponibile in magazzino",
	}),
});

export const EmployeeSchema = t.Object({
	id: t.String(),
	sellerProfileId: t.String(),
	userId: t.String(),
	status: t.Union(
		[t.Literal("active"), t.Literal("banned"), t.Literal("removed")],
		{
			description: "Stato del dipendente",
		},
	),
	createdAt: t.Date(),
});

export const OrderSchema = t.Object({
	id: t.String(),
	customerProfileId: t.String(),
	storeId: t.String(),
	type: t.Union(
		[
			t.Literal("direct"),
			t.Literal("reserve_pickup"),
			t.Literal("pay_pickup"),
			t.Literal("pay_deliver"),
		],
		{ description: "Tipo di ordine" },
	),
	status: t.Union(
		[
			t.Literal("pending"),
			t.Literal("confirmed"),
			t.Literal("ready_for_pickup"),
			t.Literal("shipped"),
			t.Literal("delivered"),
			t.Literal("completed"),
			t.Literal("cancelled"),
			t.Literal("expired"),
		],
		{ description: "Stato dell'ordine" },
	),
	total: t.String({ description: "Totale in formato decimale" }),
	shippingAddressId: t.Nullable(t.String()),
	shippingCost: t.Nullable(
		t.String({ description: "Costo di spedizione in formato decimale" }),
	),
	reservationExpiresAt: t.Nullable(
		t.Date({ description: "Scadenza della prenotazione per reserve_pickup" }),
	),
	pointsEarned: t.Number({
		minimum: 0,
		description: "Punti fedeltà guadagnati",
	}),
	pointsSpent: t.Number({ minimum: 0, description: "Punti fedeltà spesi" }),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const OrderItemSchema = t.Object({
	id: t.String(),
	orderId: t.String(),
	storeProductId: t.String(),
	quantity: t.Number({ minimum: 1, description: "Quantità ordinata" }),
	unitPrice: t.String({
		description: "Prezzo unitario al momento dell'ordine",
	}),
});

export const CustomerProfileSchema = t.Object({
	id: t.String(),
	userId: t.String(),
	points: t.Number({ minimum: 0, description: "Saldo punti fedeltà" }),
	createdAt: t.Date(),
});

export const CustomerAddressSchema = t.Object({
	id: t.String(),
	label: t.Nullable(
		t.String({ description: "Etichetta (es. 'Casa', 'Ufficio')" }),
	),
	recipientName: t.Nullable(t.String({ description: "Nome del destinatario" })),
	phone: t.Nullable(t.String({ description: "Numero di telefono" })),
	addressLine1: t.String({ description: "Indirizzo (riga 1)" }),
	addressLine2: t.Nullable(t.String({ description: "Indirizzo (riga 2)" })),
	city: t.String({ description: "Città" }),
	zipCode: t.String({ description: "CAP" }),
	province: t.Nullable(t.String({ description: "Provincia (sigla)" })),
	country: t.String({ description: "Codice paese ISO 3166-1 alpha-2" }),
	location: t.Nullable(PointXY),
	isDefault: t.Boolean({ description: "Se è l'indirizzo predefinito" }),
	customerProfileId: t.String(),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const PointTransactionSchema = t.Object({
	id: t.String(),
	customerProfileId: t.String(),
	orderId: t.Nullable(
		t.String({ description: "ID ordine associato, se applicabile" }),
	),
	amount: t.Number({
		description:
			"Quantità di punti (positiva per earned, negativa per redeemed)",
	}),
	type: t.Union(
		[t.Literal("earned"), t.Literal("redeemed"), t.Literal("refunded")],
		{
			description: "Tipo di transazione",
		},
	),
	description: t.Nullable(
		t.String({ description: "Descrizione della transazione" }),
	),
	createdAt: t.Date(),
});

// ────────────────────────────────────────────
// Location schemas
// ────────────────────────────────────────────

export const CountrySchema = t.Object({
	code: t.String({
		minLength: 2,
		maxLength: 2,
		description: "Codice ISO 3166-1 alpha-2",
	}),
	label: t.String({ description: "Nome del paese in italiano" }),
});

export const RegionSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome della regione" }),
	istatCode: t.String({ description: "Codice ISTAT della regione" }),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const ProvinceSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome della provincia" }),
	acronym: t.String({ description: "Sigla della provincia" }),
	istatCode: t.String({ description: "Codice ISTAT della provincia" }),
	regionId: t.String(),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

export const MunicipalitySchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome del comune" }),
	istatCode: t.String({ description: "Codice ISTAT del comune" }),
	provinceId: t.String(),
	createdAt: t.Date(),
	updatedAt: t.Date(),
});

// Search result
export const SearchResultSchema = t.Object({
	id: t.String(),
	name: t.String({ description: "Nome del prodotto" }),
	description: t.Nullable(
		t.String({ description: "Descrizione del prodotto" }),
	),
	price: t.String({ description: "Prezzo in formato decimale" }),
	distance: t.Number({
		minimum: 0,
		description: "Distanza in metri dal punto di ricerca",
	}),
	rank: t.Number({
		minimum: 0,
		description:
			"Punteggio di rilevanza full-text (0 se nessuna query testuale)",
	}),
	images: t.Array(
		t.Object({
			id: t.String(),
			url: t.String({ description: "URL dell'immagine" }),
			position: t.Number({
				minimum: 0,
				description: "Posizione di ordinamento",
			}),
		}),
		{ description: "Immagini del prodotto ordinate per posizione" },
	),
});
