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
	addressLine1: t.String({ description: "Indirizzo (riga 1)" }),
	addressLine2: t.Optional(t.String({ description: "Indirizzo (riga 2)" })),
	city: t.String({ description: "Città" }),
	zipCode: t.String({ description: "CAP" }),
	province: t.Optional(t.String({ description: "Provincia (sigla)" })),
	country: t.Optional(
		t.String({ description: "Codice paese ISO 3166-1 alpha-2 (default: IT)" }),
	),
	location: LocationField,
} as const;

/** Optional address fields for update/patch operations. */
export const AddressFieldsOptional = {
	addressLine1: t.Optional(t.String({ description: "Indirizzo (riga 1)" })),
	addressLine2: t.Optional(t.String({ description: "Indirizzo (riga 2)" })),
	city: t.Optional(t.String({ description: "Città" })),
	zipCode: t.Optional(t.String({ description: "CAP" })),
	province: t.Optional(t.String({ description: "Provincia (sigla)" })),
	country: t.Optional(t.String({ description: "Codice paese" })),
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
	vatNumber: t.String(),
	vatStatus: t.Union(
		[t.Literal("pending"), t.Literal("verified"), t.Literal("rejected")],
		{
			description: "Stato di verifica della partita IVA",
		},
	),
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
