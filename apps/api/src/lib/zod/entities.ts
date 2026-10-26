import { z } from "zod";
import { OpenStatusSchema } from "./holidays";
import { zDate, zInteger, zString } from "./t";

// Gemelli Zod di `lib/schemas/entities.ts` (D3 del piano Hono), nello stesso
// ordine e con gli stessi nomi; ogni unità aggiunge quelli delle sue route.
// `t.Integer` e `t.Date` di Elysia → `zInteger` e `zDate`, `t.String` con
// `minLength`/`maxLength` → `zString`, `t.Nullable` → `.nullable()`.
// Un'unione di letterali numerici (aliquote IVA) è `z.union` di `z.literal`:
// `z.enum` riordina le chiavi numeriche e cambierebbe l'ordine in /openapi.

const d = (description: string) => ({ description });

// ────────────────────────────────────────────
// Shared types
// ────────────────────────────────────────────

const PointXY = z.object({
	x: z.number().meta(d("Longitudine")),
	y: z.number().meta(d("Latitudine")),
});

// ────────────────────────────────────────────
// Reusable body field groups (for route input schemas)
// ────────────────────────────────────────────

export const LocationField = z
	.object({
		x: z.number().min(-180).max(180).meta(d("Longitudine")),
		y: z.number().min(-90).max(90).meta(d("Latitudine")),
	})
	.meta(d("Coordinate geografiche (PostGIS point)"))
	.optional();

/** Required address fields for create operations. */
export const AddressFieldsRequired = {
	addressLine1: zString({
		minLength: 1,
		maxLength: 200,
		...d("Indirizzo (riga 1)"),
	}),
	addressLine2: zString({
		maxLength: 200,
		...d("Indirizzo (riga 2)"),
	}).optional(),
	municipalityId: zString({ minLength: 1, ...d("ID del comune") }),
	zipCode: z
		.string()
		.regex(/^\d{5}$/)
		.meta(d("CAP italiano (5 cifre)")),
	country: zString({
		minLength: 2,
		maxLength: 2,
		...d("Codice paese ISO 3166-1 alpha-2 (default: IT)"),
	}).optional(),
	location: LocationField,
};

/** Optional address fields for update/patch operations. */
export const AddressFieldsOptional = {
	addressLine1: zString({
		minLength: 1,
		maxLength: 200,
		...d("Indirizzo (riga 1)"),
	}).optional(),
	addressLine2: zString({
		maxLength: 200,
		...d("Indirizzo (riga 2)"),
	}).optional(),
	municipalityId: zString({ minLength: 1, ...d("ID del comune") }).optional(),
	zipCode: z
		.string()
		.regex(/^\d{5}$/)
		.meta(d("CAP italiano (5 cifre)"))
		.optional(),
	country: zString({
		minLength: 2,
		maxLength: 2,
		...d("Codice paese"),
	}).optional(),
	location: LocationField,
};

// ────────────────────────────────────────────
// Entity schemas
// ────────────────────────────────────────────

export const UserSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
	emailVerified: z.boolean(),
	image: z.string().nullable(),
	createdAt: zDate(),
	updatedAt: zDate(),
	role: z.string().nullable(),
	banned: z.boolean().nullable(),
	banReason: z.string().nullable(),
	banExpires: zDate().nullable(),
});

// Utente visto da un altro ruolo non admin (cliente al seller, dipendente al
// titolare): solo ciò che si mostra. Mai moderazione (role/ban*) né date
// dell'account.
export const UserSummarySchema = UserSchema.pick({
	id: true,
	name: true,
	email: true,
	image: true,
});

/** Le aliquote IVA (%), nell'ordine dello schema TypeBox. */
const vatRates = () =>
	z.union([
		z.literal("22"),
		z.literal("10"),
		z.literal("5"),
		z.literal("4"),
		z.literal("0"),
	]);

export const ProductMacroCategorySchema = z.object({
	id: z.string(),
	name: z.string().meta(d("Nome della macro categoria prodotto")),
	suggestedVatRate: vatRates().meta(
		d("Aliquota IVA suggerita (%) per i prodotti di questa macro"),
	),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const BrandSchema = z.object({
	id: z.string(),
	sellerProfileId: z.string(),
	name: z.string().meta(d("Nome del brand")),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const ProductCategorySchema = z.object({
	id: z.string(),
	macroCategoryId: z
		.string()
		.meta(d("ID della macro categoria di appartenenza")),
	name: z.string().meta(d("Nome della sotto-categoria prodotto")),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const ProductCategoryWithMacroSchema = z.object({
	id: z.string(),
	macroCategoryId: z.string(),
	name: z.string().meta(d("Nome della sotto-categoria prodotto")),
	createdAt: zDate(),
	updatedAt: zDate(),
	macroCategory: ProductMacroCategorySchema,
});

export const AdminProductCategorySchema = ProductCategoryWithMacroSchema.extend(
	{
		characteristicCount: zInteger({
			description: "Numero di caratteristiche assegnate alla sotto-categoria",
		}),
	},
);

export const MunicipalityCompactSchema = z
	.object({
		id: z.string().meta(d("Identificatore univoco del comune")),
		name: z.string().meta(d("Nome del comune")),
		provinceAcronym: zString({
			minLength: 2,
			maxLength: 2,
			...d("Sigla provincia (2 lettere)"),
		}),
	})
	.meta(d("Comune in formato compatto per liste precaricate"));

export const GeocodeSuggestionSchema = z
	.object({
		label: z.string().meta({
			description: "Riga leggibile, es. 'Via Roma 12, Pioltello (MI)'",
		}),
		addressLine1: z.string().meta({
			description: "Indirizzo con civico, quando il provider lo conosce",
		}),
		zipCode: z
			.string()
			.meta({ description: "CAP, se il provider lo restituisce" })
			.nullable(),
		location: PointXY,
		municipality: MunicipalityCompactSchema.nullable(),
		municipalityCandidates: z.array(MunicipalityCompactSchema).meta({
			description:
				"Comuni omonimi fra cui deve scegliere il cliente quando la risoluzione è incerta",
		}),
		providerRef: z.string().meta({
			description: "Riferimento opaco del provider, usato per il dedup",
		}),
	})
	.meta({ description: "Suggerimento di indirizzo geocodificato" });

export const SellerProfileSchema = z.object({
	id: z.string(),
	userId: z.string(),
	onboardingStatus: z
		.enum([
			"pending_email",
			"pending_personal",
			"pending_document",
			"pending_company",
			"pending_review",
			"active",
			"rejected",
		])
		.meta({ description: "Stato dell'onboarding del venditore" }),
	firstName: z.string().nullable(),
	lastName: z.string().nullable(),
	citizenship: z.string().nullable(),
	birthCountry: z.string().nullable(),
	birthDate: z
		.string()
		.meta({ description: "Data di nascita (YYYY-MM-DD)" })
		.nullable(),
	residenceCountry: z.string().nullable(),
	residenceMunicipalityId: z.string().nullable(),
	residenceMunicipality: MunicipalityCompactSchema.nullable(),
	residenceAddress: z.string().nullable(),
	residenceZipCode: z.string().nullable(),
	documentType: z
		.enum(["identity_card", "driving_license", "passport"])
		.meta({ description: "Tipo di documento d'identità" })
		.nullable(),
	documentNumber: z.string().nullable(),
	documentExpiry: z
		.string()
		.meta({ description: "Scadenza documento (YYYY-MM-DD)" })
		.nullable(),
	documentIssuedMunicipalityId: z.string().nullable(),
	documentIssuedMunicipality: MunicipalityCompactSchema.nullable(),
	documentImageUrl: z.string().nullable(),
	vatChangeBlocked: z.boolean().meta({
		description:
			"Se true, il seller ha una richiesta di cambio P.IVA in attesa e non può ricevere nuovi ordini",
	}),
	rejectionReason: z
		.string()
		.meta({
			description:
				"Motivo dell'ultimo rifiuto della candidatura, azzerato all'approvazione",
		})
		.nullable(),
	createdAt: zDate(),
});

export const OrganizationSchema = z.object({
	id: z.string(),
	sellerProfileId: z.string(),
	businessName: z.string().meta({ description: "Ragione sociale" }),
	vatNumber: z.string().meta({ description: "Partita IVA" }),
	legalForm: z.string().meta({ description: "Forma giuridica" }),
	addressLine1: z.string().meta({ description: "Indirizzo sede legale" }),
	country: z.string().meta({ description: "Codice paese ISO 3166-1 alpha-2" }),
	municipalityId: z.string().meta({ description: "ID comune sede legale" }),
	municipality: MunicipalityCompactSchema,
	zipCode: z.string().meta({ description: "CAP" }),
	vatStatus: z
		.enum(["pending", "verified", "rejected"])
		.meta({ description: "Stato di verifica della partita IVA" }),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const StoreMacroCategorySchema = z.object({
	id: z.string(),
	name: z.string().meta(d("Nome della macro categoria negozio")),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const StoreCategorySchema = z.object({
	id: z.string(),
	macroCategoryId: z
		.string()
		.meta(d("ID della macro categoria di appartenenza")),
	name: z.string().meta(d("Nome della categoria negozio")),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const StoreCategoryWithMacroSchema = StoreCategorySchema.extend({
	macroCategory: StoreMacroCategorySchema,
});

export const StoreImageSchema = z.object({
	id: z.string(),
	storeId: z.string(),
	url: z.string().meta(d("URL pubblico dell'immagine")),
	key: z.string().meta(d("Chiave S3")),
	position: z.number().min(0).meta(d("Posizione di ordinamento")),
	createdAt: zDate(),
});

export const OnlinePaymentsSchema = z.object({
	status: z
		.enum(["none", "incomplete", "in_review", "enabled"])
		.meta(
			d(
				"Stato dei pagamenti online: none (da attivare), incomplete (onboarding da completare), in_review (in verifica da Stripe), enabled (attivi)",
			),
		),
	chargesEnabled: z.boolean(),
	payoutsEnabled: z.boolean(),
});

export const StoreSchema = z.object({
	id: z.string(),
	sellerProfileId: z.string(),
	name: z.string().meta(d("Nome del negozio")),
	description: z.string().meta(d("Descrizione del negozio")).nullable(),
	addressLine1: z.string().meta(d("Indirizzo (riga 1)")),
	addressLine2: z.string().meta(d("Indirizzo (riga 2)")).nullable(),
	municipalityId: z.string().meta(d("ID comune del negozio")),
	municipality: MunicipalityCompactSchema,
	zipCode: z.string().meta(d("CAP")),
	country: z.string().meta(d("Codice paese ISO 3166-1 alpha-2")),
	location: PointXY.nullable(),
	categoryId: z.string().meta(d("ID categoria negozio")).nullable(),
	openingHours: z
		.array(
			z.object({
				dayOfWeek: zInteger({
					minimum: 0,
					maximum: 6,
					description: "Giorno della settimana (0=Lunedì, 6=Domenica)",
				}),
				slots: z.array(
					z.object({
						open: z.string().meta(d("Orario apertura (HH:mm)")),
						close: z.string().meta(d("Orario chiusura (HH:mm)")),
					}),
				),
			}),
		)
		.meta(d("Orari di apertura del negozio"))
		.nullable(),
	websiteUrl: z.string().meta(d("URL del sito web")).nullable(),
	createdAt: zDate(),
	updatedAt: zDate(),
});

const productStatus = () => z.enum(["active", "disabled", "trashed"]);

export const ProductSchema = z.object({
	id: z.string(),
	sellerProfileId: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	price: z.string().meta(d("Prezzo in formato decimale (es. '9.99')")),
	vatRate: vatRates().meta(
		d("Aliquota IVA del prodotto (%): 22, 10, 5, 4 o 0"),
	),
	// `default` solo nel JSON Schema, come in TypeBox: una risposta non riceve default.
	status: productStatus().meta({
		description:
			"Stato del prodotto: 'active' (visibile), 'disabled' (nascosto al customer), 'trashed' (in cestino, eliminabile fisicamente)",
		default: "active",
	}),
	ean: z.string().meta(d("Codice EAN-8 o EAN-13")).nullable(),
	brandId: z.string().meta(d("ID del brand del venditore")).nullable(),
	productCategoryId: z
		.string()
		.meta(d("ID della sotto-categoria del prodotto"))
		.nullable(),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const ProductStatusBody = z.object({
	status: productStatus().meta(d("Nuovo stato del prodotto")),
});

const productIds = () => z.array(z.string()).min(1).max(100);

export const BulkStatusBody = z.object({
	productIds: productIds(),
	status: productStatus().meta(d("Stato target da applicare a tutti gli ID")),
});

export const BulkStatusResult = z.object({
	succeeded: z
		.array(z.string())
		.meta(d("ID dei prodotti cambiati (o già nello stato richiesto)")),
	failed: z.array(
		z.object({
			productId: z.string(),
			reason: z.enum(["not_found", "no_access", "ean_conflict"]),
		}),
	),
});

export const ProductStatusCounts = z.object({
	active: zInteger({ minimum: 0 }),
	disabled: zInteger({ minimum: 0 }),
	trashed: zInteger({ minimum: 0 }),
});

export const BulkDeleteBody = z.object({
	productIds: productIds(),
});

export const BulkDeleteResult = z.object({
	succeeded: z.array(z.string()),
	failed: z.array(
		z.object({
			productId: z.string(),
			reason: z.enum(["not_found", "no_access", "not_in_trash"]),
		}),
	),
});

export const EanLookupResultSchema = z.object({
	name: z.string(),
	description: z.string().nullable(),
	ean: z.string(),
	brandName: z
		.string()
		.meta(
			d(
				"Nome del brand del prodotto sorgente — il venditore corrente farà match-or-create",
			),
		)
		.nullable(),
	macroCategoryId: z.string().nullable(),
	productCategoryId: z
		.string()
		.meta(d("ID della sotto-categoria del prodotto sorgente"))
		.nullable(),
});

export const ProductImageSchema = z.object({
	id: z.string(),
	productId: z.string(),
	url: z.string().meta(d("URL pubblico dell'immagine")),
	key: z.string().meta(d("Chiave S3")),
	position: z.number().min(0).meta(d("Posizione di ordinamento")),
	createdAt: zDate(),
});

export const StorePhoneNumberSchema = z.object({
	id: z.string(),
	storeId: z.string(),
	label: z
		.string()
		.meta(d("Etichetta (es. 'Principale', 'WhatsApp')"))
		.nullable(),
	number: z.string().meta(d("Numero di telefono")),
	position: z.number().min(0).meta(d("Posizione di ordinamento")),
	createdAt: zDate(),
});

const csvRow = (message: string) =>
	z.object({
		row: z.number().meta(d("Numero di riga nel CSV (partendo da 2)")),
		message: z.string().meta(d(message)),
	});

export const CsvImportResultSchema = z.object({
	created: z.number().meta(d("Numero di righe create con successo")),
	skipped: z.number().meta(d("Numero di righe saltate perché già presenti")),
	failed: z.number().meta(d("Numero di righe con errori")),
	errors: z.array(csvRow("Descrizione dell'errore")),
});

export const ProductCsvImportResultSchema = CsvImportResultSchema.extend({
	warnings: z
		.array(csvRow("Cosa è stato saltato o scartato"))
		.meta(
			d(
				"Righe saltate o importate con qualcosa scartato: EAN già usato, categorie oltre la prima",
			),
		),
});

// Import della matrice categoria-caratteristiche: solo additivo, con `missing`
// per segnalare la divergenza (vedi lo schema TypeBox).
export const CsvImportWithMissingResultSchema = CsvImportResultSchema.extend({
	missing: z
		.array(
			z.object({
				subcategory: z.string(),
				macroCategory: z
					.string()
					.meta(
						d(
							'Macro categoria della sotto-categoria: il nome della sotto-categoria da solo non è univoco (si ripete sotto macro diverse, es. "Stampanti").',
						),
					),
				characteristics: z.array(z.string()),
			}),
		)
		.meta(
			d(
				"Righe presenti nel database e assenti dal file, per sotto-categoria. L'import non cancella nulla: servono a vedere dove il foglio e il database divergono.",
			),
		),
});

// Import «in aggiornamento»: righe create o aggiornate, nessuna saltata.
export const CsvUpsertResultSchema = z.object({
	created: z.number().meta(d("Numero di righe create con successo")),
	updated: z.number().meta(d("Numero di righe già presenti e aggiornate")),
	failed: z.number().meta(d("Numero di righe con errori")),
	errors: z.array(csvRow("Descrizione dell'errore")),
});

export const CharacteristicDataTypeSchema = z
	.enum(["text", "number", "boolean", "enum"])
	.meta(
		d(
			"Tipo di dato: text (testo libero), number (numero, con unità facoltativa), boolean (sì/no), enum (lista chiusa di opzioni)",
		),
	);

export const ProductCharacteristicSchema = z.object({
	id: z.string(),
	name: z.string().meta(d("Nome della caratteristica")),
	dataType: CharacteristicDataTypeSchema,
	unit: z
		.string()
		.meta(d("Unità di misura, solo per il tipo number"))
		.nullable(),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const AdminProductCharacteristicSchema =
	ProductCharacteristicSchema.extend({
		valueCount: zInteger({
			description:
				"Numero di prodotti che hanno un valore per questa caratteristica",
		}),
		options: z
			.array(
				z.object({
					id: z.string(),
					value: z.string().meta(d("Valore ammesso")),
					sortOrder: zInteger({ description: "Posizione nella lista" }),
					valueCount: zInteger({
						description: "Numero di prodotti che hanno scelto questa opzione",
					}),
				}),
			)
			.meta(d("Opzioni della lista chiusa, vuota per gli altri tipi")),
	});

export const CategoryCharacteristicStateSchema = z.object({
	id: z.string().meta(d("ID della caratteristica")),
	name: z.string().meta(d("Nome della caratteristica")),
	dataType: CharacteristicDataTypeSchema,
	unit: z.string().nullable(),
	included: z
		.boolean()
		.meta(d("La caratteristica è assegnata alla sotto-categoria")),
	required: z
		.boolean()
		.meta(d("Il venditore deve compilarla (sempre false se non inclusa)")),
	valueCount: zInteger({
		description:
			"Prodotti della sotto-categoria che hanno già un valore per questa caratteristica",
	}),
});

export const CategoryCharacteristicLinkSchema = z.object({
	productCategoryId: z.string(),
	characteristicId: z.string(),
	required: z.boolean(),
	sortOrder: zInteger({ description: "Posizione nel form del venditore" }),
});

export const SellerCategoryCharacteristicSchema = z.object({
	id: z.string().meta(d("ID della caratteristica")),
	name: z.string().meta(d("Nome della caratteristica")),
	dataType: CharacteristicDataTypeSchema,
	unit: z
		.string()
		.meta(d("Unità di misura, solo per il tipo number"))
		.nullable(),
	required: z
		.boolean()
		.meta(
			d(
				"Obbligatoria: va compilata quando il prodotto nasce o cambia sotto-categoria, e una volta compilata non si può svuotare",
			),
		),
	options: z
		.array(
			z.object({
				id: z.string().meta(d("ID dell'opzione, il valore da inviare")),
				value: z.string().meta(d("Etichetta dell'opzione")),
			}),
		)
		.meta(d("Opzioni della lista chiusa, vuota per gli altri tipi")),
});

export const CharacteristicOutputValueSchema = z
	.union([z.string(), z.number(), z.boolean()])
	.meta(
		d(
			"Testo, numero o sì/no secondo il tipo; per le liste chiuse, l'ID dell'opzione",
		),
	);

export const ProductCharacteristicValueSchema = z.object({
	characteristicId: z.string().meta(d("ID della caratteristica")),
	name: z.string().meta(d("Nome della caratteristica")),
	value: CharacteristicOutputValueSchema,
});

export const StoreProductSchema = z.object({
	id: z.string(),
	productId: z.string(),
	storeId: z.string(),
	stock: z.number().min(0).meta(d("Quantità disponibile in magazzino")),
});

export const EmployeeSchema = z.object({
	id: z.string(),
	sellerProfileId: z.string(),
	userId: z.string(),
	status: z
		.enum(["active", "banned", "removed"])
		.meta(d("Stato del dipendente")),
	createdAt: zDate(),
});

export const OrderSchema = z.object({
	id: z.string(),
	customerProfileId: z.string(),
	storeId: z.string(),
	type: z
		.enum(["direct", "reserve_pickup", "pay_pickup", "pay_deliver"])
		.meta(d("Tipo di ordine")),
	status: z
		.enum([
			"pending",
			"confirmed",
			"ready_for_pickup",
			"shipped",
			"delivered",
			"completed",
			"cancelled",
			"expired",
		])
		.meta(d("Stato dell'ordine")),
	total: z.string().meta(d("Totale in formato decimale")),
	shippingAddressId: z.string().nullable(),
	checkoutId: z.string().meta(d("Checkout che ha creato l'ordine")).nullable(),
	pickupCode: z
		.string()
		.meta(d("Codice di ritiro al banco (solo ordini da ritirare)"))
		.nullable(),
	shippingAddressSnapshot: z
		.object({
			recipientName: z.string().nullable(),
			phone: z.string().nullable(),
			addressLine1: z.string(),
			addressLine2: z.string().nullable(),
			zipCode: z.string(),
			municipalityName: z.string(),
			provinceAcronym: z.string(),
			country: z.string(),
		})
		.meta(
			d(
				"Copia dell'indirizzo di spedizione al momento dell'ordine. NULL per ordini senza spedizione o storici",
			),
		)
		.nullable(),
	shippingCost: z
		.string()
		.meta(d("Costo di spedizione in formato decimale"))
		.nullable(),
	vatBreakdown: z
		.array(
			z.object({
				rate: z.number().meta(d("Aliquota IVA (%)")),
				taxableAmount: z.string().meta(d("Imponibile (netto)")),
				taxAmount: z.string().meta(d("Imposta (IVA)")),
			}),
		)
		.meta(d("Castelletto IVA per aliquota. NULL per ordini storici"))
		.nullable(),
	reservationExpiresAt: zDate({
		description: "Scadenza della prenotazione per reserve_pickup",
	}).nullable(),
	paymentExpiresAt: zDate({
		description:
			"Solo ordini da pagare online: oltre questa data un ordine ancora in attesa di pagamento si annulla",
	}).nullable(),
	pointsEarned: z.number().min(0).meta(d("Punti fedeltà guadagnati")),
	pointsSpent: z.number().min(0).meta(d("Punti fedeltà spesi")),
	pointsDiscount: z
		.string()
		.meta(d("Sconto punti in euro, coperto da bibs (0 se nessun punto)")),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const OrderItemSchema = z.object({
	id: z.string(),
	orderId: z.string(),
	storeProductId: z
		.string()
		.meta(
			d(
				"FK al store_product. NULL se il prodotto è stato rimosso dopo l'ordine",
			),
		)
		.nullable(),
	productId: z
		.string()
		.meta(d("FK al product. NULL se il prodotto è stato rimosso dopo l'ordine"))
		.nullable(),
	productName: z
		.string()
		.meta(d("Snapshot del nome prodotto al momento dell'ordine")),
	productEan: z
		.string()
		.meta(d("Snapshot EAN al momento dell'ordine"))
		.nullable(),
	brandName: z
		.string()
		.meta(d("Snapshot nome brand al momento dell'ordine"))
		.nullable(),
	productImageUrl: z
		.string()
		.meta(d("Snapshot URL prima immagine al momento dell'ordine"))
		.nullable(),
	quantity: z.number().min(1).meta(d("Quantità ordinata")),
	unitPrice: z
		.string()
		.meta(
			d(
				"Prezzo unitario effettivamente addebitato al momento dell'ordine (già scontato se uno sconto era attivo)",
			),
		),
	listPrice: z
		.string()
		.meta(
			d(
				"Snapshot prezzo di listino al momento dell'ordine. NULL per ordini storici",
			),
		)
		.nullable(),
	discountPercent: z
		.number()
		.min(1)
		.max(99)
		.meta(
			d(
				"Percentuale sconto venditore applicata alla riga. NULL se nessuno sconto era attivo",
			),
		)
		.nullable(),
	vatRate: z
		.string()
		.meta(d("Snapshot aliquota IVA applicata (%). NULL per ordini storici"))
		.nullable(),
	vatAmount: z
		.string()
		.meta(d("IVA della riga (display). NULL per ordini storici"))
		.nullable(),
});

export const CustomerProfileSchema = z.object({
	id: z.string(),
	userId: z.string(),
	points: z.number().min(0).meta({ description: "Saldo punti fedeltà" }),
	createdAt: zDate(),
});

export const CustomerAddressSchema = z.object({
	id: z.string(),
	label: z.string().meta(d("Etichetta (es. 'Casa', 'Ufficio')")).nullable(),
	recipientName: z.string().meta(d("Nome del destinatario")).nullable(),
	phone: z.string().meta(d("Numero di telefono")).nullable(),
	addressLine1: z.string().meta(d("Indirizzo (riga 1)")),
	addressLine2: z.string().meta(d("Indirizzo (riga 2)")).nullable(),
	municipalityId: z.string().meta(d("ID del comune")),
	municipality: MunicipalityCompactSchema,
	zipCode: z.string().meta(d("CAP")),
	country: z.string().meta(d("Codice paese ISO 3166-1 alpha-2")),
	location: PointXY.nullable(),
	isDefault: z.boolean().meta(d("Se è l'indirizzo predefinito")),
	customerProfileId: z.string(),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const EmployeeInvitationSchema = z.object({
	id: z.string(),
	sellerProfileId: z.string(),
	email: z.string().meta(d("Email del collaboratore invitato")),
	status: z
		.enum(["pending", "accepted", "expired"])
		.meta(d("Stato dell'invito")),
	expiresAt: zDate({ description: "Scadenza dell'invito" }),
	createdAt: zDate(),
	storeIds: z
		.array(z.string())
		.meta(d("ID dei negozi preselezionati per l'invito")),
});

export const PointTransactionSchema = z.object({
	id: z.string(),
	customerProfileId: z.string(),
	orderId: z.string().meta(d("ID ordine associato, se applicabile")).nullable(),
	amount: z
		.number()
		.meta(
			d(
				"Quantità di punti con segno: positiva per earned e refunded, negativa per redeemed. La somma dei movimenti è il saldo.",
			),
		),
	type: z
		.enum(["earned", "redeemed", "refunded"])
		.meta(d("Tipo di transazione")),
	description: z.string().meta(d("Descrizione della transazione")).nullable(),
	createdAt: zDate(),
});

// ────────────────────────────────────────────
// Location schemas
// ────────────────────────────────────────────

export const CountrySchema = z.object({
	code: zString({
		minLength: 2,
		maxLength: 2,
		description: "Codice ISO 3166-1 alpha-2",
	}),
	label: z.string().meta({ description: "Nome del paese in italiano" }),
});

export const RegionSchema = z.object({
	id: z.string(),
	name: z.string().meta({ description: "Nome della regione" }),
	istatCode: z.string().meta({ description: "Codice ISTAT della regione" }),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const ProvinceSchema = z.object({
	id: z.string(),
	name: z.string().meta({ description: "Nome della provincia" }),
	acronym: z.string().meta({ description: "Sigla della provincia" }),
	istatCode: z.string().meta({ description: "Codice ISTAT della provincia" }),
	regionId: z.string(),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const MunicipalitySchema = z.object({
	id: z.string(),
	name: z.string().meta({ description: "Nome del comune" }),
	istatCode: z.string().meta({ description: "Codice ISTAT del comune" }),
	provinceId: z.string(),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const SellerProfileChangeSchema = z.object({
	id: z.string(),
	sellerProfileId: z.string(),
	changeType: z.enum(["vat", "document"]).meta(d("Tipo di modifica richiesta")),
	changeData: z.unknown().meta(d("Dati della modifica (JSON)")),
	status: z
		.enum(["pending", "approved", "rejected", "cancelled"])
		.meta(d("Stato della richiesta")),
	reviewedBy: z.string().nullable(),
	reviewedAt: zDate().nullable(),
	rejectionReason: z.string().nullable(),
	createdAt: zDate(),
});

// Store discovery card (customer public search)
export const StoreCardSchema = z.object({
	id: z.string(),
	name: z.string().meta(d("Nome del negozio")),
	category: z.object({ id: z.string(), name: z.string() }).nullable(),
	municipality: MunicipalityCompactSchema,
	addressLine1: z.string().meta(d("Indirizzo (riga 1)")),
	distance: z
		.number()
		.min(0)
		.meta(
			d(
				"Distanza in metri dalla posizione utente (null senza geo o senza posizione del negozio)",
			),
		)
		.nullable(),
	image: z
		.object({ url: z.string().meta(d("URL immagine principale")) })
		.nullable(),
	openStatus: OpenStatusSchema,
});

export const StoreMapPinSchema = z.object({
	id: z.string(),
	name: z.string().meta(d("Nome del negozio")),
	coordinates: z.object({
		lat: z.number().meta(d("Latitudine")),
		lng: z.number().meta(d("Longitudine")),
	}),
	category: z.object({ id: z.string(), name: z.string() }).nullable(),
	municipality: MunicipalityCompactSchema,
	distance: z
		.number()
		.min(0)
		.meta(d("Distanza in metri dalla posizione utente (null senza geo)"))
		.nullable(),
	image: z
		.object({ url: z.string().meta(d("URL immagine principale")) })
		.nullable(),
	openStatus: OpenStatusSchema,
});

export const StoreMapSchema = z.object({
	pins: z.array(StoreMapPinSchema),
	total: zInteger({
		description:
			"Negozi che corrispondono ai filtri, con o senza posizione: lo stesso numero della lista",
	}),
	mappable: zInteger({
		description: "Quanti di quei negozi hanno una posizione sulla mappa",
	}),
	truncated: z
		.boolean()
		.meta(d("true quando i negozi mappabili superano il tetto di 500 pin")),
});

// Weekly opening hours (response shape), dayOfWeek 0=Lun..6=Dom
const StoreOpeningHoursSchema = z.array(
	z.object({
		dayOfWeek: zInteger({
			minimum: 0,
			maximum: 6,
			description: "0=Lun..6=Dom",
		}),
		slots: z.array(
			z.object({
				open: z.string().meta(d("Apertura HH:mm")),
				close: z.string().meta(d("Chiusura HH:mm")),
			}),
		),
	}),
);

// Store detail (customer public store page — #2a)
export const StoreDetailSchema = z.object({
	id: z.string(),
	name: z.string().meta(d("Nome del negozio")),
	description: z.string().meta(d("Descrizione del negozio")).nullable(),
	category: z.object({ id: z.string(), name: z.string() }).nullable(),
	municipality: MunicipalityCompactSchema,
	addressLine1: z.string().meta(d("Indirizzo (riga 1)")),
	addressLine2: z.string().meta(d("Indirizzo (riga 2)")).nullable(),
	zipCode: z.string().meta(d("CAP")),
	coordinates: z
		.object({
			lat: z.number().meta(d("Latitudine")),
			lng: z.number().meta(d("Longitudine")),
		})
		.nullable(),
	images: z
		.array(
			z.object({
				id: z.string(),
				url: z.string().meta(d("URL immagine")),
			}),
		)
		.meta(d("Immagini del negozio ordinate per posizione")),
	phoneNumbers: z
		.array(
			z.object({
				id: z.string(),
				label: z.string().meta(d("Etichetta (es. Negozio)")).nullable(),
				number: z.string().meta(d("Numero di telefono")),
			}),
		)
		.meta(d("Telefoni ordinati per posizione")),
	websiteUrl: z.string().meta(d("Sito web")).nullable(),
	openingHours: StoreOpeningHoursSchema.nullable(),
	openStatus: OpenStatusSchema,
});

const ProductImageCard = (description?: string) =>
	z.object({
		id: z.string(),
		url: z.string().meta(d("URL dell'immagine")),
		position: description
			? z.number().min(0).meta(d(description))
			: z.number().min(0),
	});

// Store product card (customer store catalog — #2b).
export const StoreProductCardSchema = z.object({
	id: z.string(),
	storeProductId: z
		.string()
		.meta(d("ID della riga store_products, da usare per ordinare")),
	stock: zInteger({
		minimum: 0,
		description: "Disponibilità del prodotto in questo negozio",
	}),
	name: z.string().meta(d("Nome del prodotto")),
	description: z.string().meta(d("Descrizione del prodotto")).nullable(),
	price: z.string().meta(d("Prezzo in formato decimale")),
	images: z
		.array(ProductImageCard("Posizione di ordinamento"))
		.meta(d("Immagini del prodotto ordinate per posizione")),
	discountedPrice: z
		.string()
		.meta(d("Prezzo scontato, se promo attiva"))
		.nullable(),
	discountPercent: zInteger({ minimum: 1, maximum: 99 }).nullable(),
});

// Product search card (customer /products).
export const ProductCardSchema = z.object({
	id: z.string(),
	name: z.string().meta(d("Nome del prodotto")),
	description: z.string().meta(d("Descrizione del prodotto")).nullable(),
	price: z.string().meta(d("Prezzo di listino in formato decimale")),
	storeProductId: z
		.string()
		.meta(d("ID della riga store_products del negozio agganciato")),
	stock: zInteger({
		minimum: 0,
		description: "Disponibilità nel negozio agganciato",
	}),
	store: z
		.object({
			id: z.string(),
			name: z.string().meta(d("Nome del negozio")),
			municipality: MunicipalityCompactSchema,
		})
		.meta(d("Il negozio più vicino che ha il prodotto fra quelli filtrati")),
	distance: z
		.number()
		.min(0)
		.meta(d("Distanza in metri dall'origine (null senza origine)"))
		.nullable(),
	otherStoreCount: zInteger({
		minimum: 0,
		description:
			"Altri negozi che soddisfano i filtri, oltre a quello agganciato",
	}),
	rank: z
		.number()
		.min(0)
		.meta(d("Punteggio di rilevanza full-text (0 senza query testuale)")),
	images: z
		.array(ProductImageCard("Posizione di ordinamento"))
		.meta(d("Immagini del prodotto ordinate per posizione")),
	discountedPrice: z
		.string()
		.meta(d("Prezzo scontato, se promo attiva"))
		.nullable(),
	discountPercent: zInteger({ minimum: 1, maximum: 99 }).nullable(),
});

// Scheda prodotto customer. Un valore di testo può somigliare a una data
// ("05/03/2027"): con `hc` resta testo (Eden lo idratava in `Date`).
export const CustomerProductCharacteristicSchema = z.object({
	characteristicId: z.string().meta(d("ID della caratteristica")),
	name: z.string().meta(d("Nome della caratteristica")),
	dataType: CharacteristicDataTypeSchema,
	unit: z
		.string()
		.meta(d("Unità di misura, solo per il tipo number"))
		.nullable(),
	value: z
		.union([z.string(), z.number(), z.boolean()])
		.meta(
			d(
				"Testo, numero o sì/no secondo il tipo; per le liste chiuse, l'etichetta dell'opzione",
			),
		),
});

export const CustomerProductDetailSchema = z.object({
	id: z.string(),
	name: z.string().meta(d("Nome del prodotto")),
	description: z.string().meta(d("Descrizione del prodotto")).nullable(),
	price: z.string().meta(d("Prezzo di listino in formato decimale")),
	discountedPrice: z
		.string()
		.meta(d("Prezzo scontato, se promo attiva"))
		.nullable(),
	discountPercent: zInteger({ minimum: 1, maximum: 99 }).nullable(),
	brandName: z.string().meta(d("Marca del prodotto")).nullable(),
	category: z
		.object({
			id: z.string(),
			name: z.string().meta(d("Sotto-categoria")),
			macroCategory: z.object({
				id: z.string(),
				name: z.string().meta(d("Macro-categoria")),
			}),
		})
		.nullable(),
	images: z
		.array(ProductImageCard())
		.meta(d("Immagini del prodotto ordinate per posizione")),
	offer: z
		.object({
			storeProductId: z
				.string()
				.meta(d("ID della riga store_products, da usare per il carrello")),
			stock: zInteger({
				minimum: 0,
				description: "Disponibilità nel negozio agganciato",
			}),
			distance: z
				.number()
				.min(0)
				.meta(d("Distanza in metri dall'origine (null senza origine)"))
				.nullable(),
			store: z.object({
				id: z.string(),
				name: z.string().meta(d("Nome del negozio")),
				municipality: MunicipalityCompactSchema,
			}),
		})
		.meta(
			d(
				"Il negozio agganciato: quello richiesto se ce l'ha, altrimenti il più vicino, altrimenti il primo per nome",
			),
		),
	otherStoreCount: zInteger({
		minimum: 0,
		description: "Altri negozi visibili che lo hanno disponibile",
	}),
	requestedStoreUnavailable: z
		.boolean()
		.meta(
			d(
				"Il negozio richiesto non ha il prodotto disponibile: ne è stato agganciato un altro",
			),
		),
	characteristics: z
		.array(CustomerProductCharacteristicSchema)
		.meta(
			d(
				"Solo le caratteristiche valorizzate, nell'ordine della matrice della sotto-categoria",
			),
		),
});

const ProductCategoryFacetSchema = z.object({
	id: z.string(),
	name: z.string().meta(d("Nome della categoria")),
	productCount: zInteger({
		minimum: 0,
		description: "Prodotti in questa categoria",
	}),
});

export const ProductFacetsSchema = z.object({
	total: zInteger({
		minimum: 0,
		description:
			"Prodotti che corrispondono a testo, geografia, prezzo e offerta",
	}),
	openNowTotal: zInteger({
		minimum: 0,
		description: "Quanti di quei prodotti restano accendendo «Aperti ora»",
	}),
	onSaleTotal: zInteger({
		minimum: 0,
		description: "Quanti di quei prodotti restano accendendo «Solo in offerta»",
	}),
	macros: z
		.array(
			z.object({
				id: z.string(),
				name: z.string().meta(d("Nome della macro categoria")),
				productCount: zInteger({ minimum: 0 }),
				categories: z.array(ProductCategoryFacetSchema),
			}),
		)
		.meta(d("Macro categorie con almeno un prodotto, in ordine alfabetico")),
});

// Carrello customer: nessun campo data (createdAt/updatedAt restano in tabella).
export const CartItemSchema = z.object({
	id: z.string().meta(d("ID della riga di carrello")),
	storeProductId: z
		.string()
		.meta(d("ID della riga store_products, da usare per ordinare")),
	quantity: zInteger({ minimum: 1, description: "Quantità nel carrello" }),
	product: z.object({
		id: z.string(),
		name: z.string().meta(d("Nome del prodotto")),
		imageUrl: z
			.string()
			.meta(d("URL della prima immagine del prodotto"))
			.nullable(),
	}),
	unitPrice: z.string().meta(d("Prezzo di listino in formato decimale")),
	discountedPrice: z
		.string()
		.meta(d("Prezzo scontato, se promo attiva"))
		.nullable(),
	discountPercent: zInteger({ minimum: 1, maximum: 99 }).nullable(),
	lineTotal: z
		.string()
		.meta(d("Totale di riga: prezzo effettivo per quantità")),
	availableStock: zInteger({
		minimum: 0,
		description: "Disponibilità residua nel negozio",
	}),
	issue: z
		.enum(["ok", "insufficient_stock", "unavailable"])
		.meta(
			d(
				"Stato della riga: ok, disponibilità insufficiente, oppure non più acquistabile (negozio non visibile o prodotto non attivo)",
			),
		),
});

export const CartStoreGroupSchema = z.object({
	store: z.object({
		id: z.string(),
		name: z.string().meta(d("Nome del negozio")),
		municipality: z.object({
			name: z.string().meta(d("Comune del negozio")),
			provinceAcronym: z.string().meta(d("Sigla della provincia")),
		}),
		orderTypes: z
			.array(z.enum(["reserve_pickup", "pay_pickup"]))
			.meta(d("Tipi d'ordine offerti al checkout per questo negozio")),
	}),
	items: z.array(CartItemSchema),
	subtotal: z
		.string()
		.meta(d("Subtotale del negozio, escluse le righe non più acquistabili")),
});

export const CartSchema = z.object({
	groups: z
		.array(CartStoreGroupSchema)
		.meta(d("Righe raggruppate per negozio, ordinate per nome")),
	itemCount: zInteger({
		minimum: 0,
		description: "Somma delle quantità, righe problematiche incluse",
	}),
	total: z
		.string()
		.meta(d("Totale del carrello, escluse le righe non acquistabili")),
});

export const CartItemMutationSchema = z.object({
	id: z.string().meta(d("ID della riga di carrello")),
	quantity: zInteger({ minimum: 1, description: "Quantità risultante" }),
});

const storeOrderType = () => z.enum(["reserve_pickup", "pay_pickup"]);

export const ReservationDeadlineSchema = z.object({
	hours: zInteger({
		description: "Ore entro cui ritirare una prenotazione nel negozio",
	}),
	expiresAt: zDate({
		description: "Scadenza di una prenotazione fatta adesso",
	}),
	clock: z
		.enum(["opening", "calendar"])
		.meta(
			d(
				"opening = contate le ore di apertura; calendar = negozio senza orari, ore di calendario",
			),
		),
});

export const StoreReservationDeadlineSchema = z.object({
	storeId: z.string().meta(d("ID del negozio")),
	...ReservationDeadlineSchema.shape,
});

export const StoreOrderTypesSchema = z.object({
	orderTypes: z
		.array(storeOrderType())
		.meta(d("Tipologie configurate dal negozio")),
	offeredOrderTypes: z
		.array(storeOrderType())
		.meta(d("Tipologie che i clienti vedono al checkout")),
	chargesEnabled: z
		.boolean()
		.meta(d("Il venditore può incassare online (Stripe Connect)")),
	vatChangeBlocked: z
		.boolean()
		.meta(
			d(
				"Cambio partita IVA in attesa: gli ordini sono bloccati finché l'admin non decide",
			),
		),
});
