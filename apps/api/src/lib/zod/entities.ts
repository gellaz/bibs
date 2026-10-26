import { z } from "zod";
import { zDate, zInteger } from "./t";

// Gemelli Zod di `lib/schemas/entities.ts` (D3 del piano Hono), nello stesso
// ordine e con gli stessi nomi; ogni unità aggiunge quelli delle sue route.
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

export const ProductCategoryWithMacroSchema = z.object({
	id: z.string(),
	macroCategoryId: z.string(),
	name: z.string().meta(d("Nome della sotto-categoria prodotto")),
	createdAt: zDate(),
	updatedAt: zDate(),
	macroCategory: ProductMacroCategorySchema,
});

export const MunicipalityCompactSchema = z
	.object({
		id: z.string().meta({ description: "Identificatore univoco del comune" }),
		name: z.string().meta({ description: "Nome del comune" }),
		provinceAcronym: z
			.string()
			.min(2)
			.max(2)
			.meta({ description: "Sigla provincia (2 lettere)" }),
	})
	.meta({ description: "Comune in formato compatto per liste precaricate" });

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

export const CharacteristicDataTypeSchema = z
	.enum(["text", "number", "boolean", "enum"])
	.meta(
		d(
			"Tipo di dato: text (testo libero), number (numero, con unità facoltativa), boolean (sì/no), enum (lista chiusa di opzioni)",
		),
	);

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

// ────────────────────────────────────────────
// Location schemas
// ────────────────────────────────────────────

export const CountrySchema = z.object({
	code: z
		.string()
		.min(2)
		.max(2)
		.meta({ description: "Codice ISO 3166-1 alpha-2" }),
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
