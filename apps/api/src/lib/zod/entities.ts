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
// Reusable body field groups (for route input schemas)
// ────────────────────────────────────────────

export const LocationField = z
	.object({
		x: z.number().min(-180).max(180).meta(d("Longitudine")),
		y: z.number().min(-90).max(90).meta(d("Latitudine")),
	})
	.meta(d("Coordinate geografiche (PostGIS point)"))
	.optional();

/** Optional address fields for update/patch operations. */
export const AddressFieldsOptional = {
	addressLine1: z
		.string()
		.min(1)
		.max(200)
		.meta(d("Indirizzo (riga 1)"))
		.optional(),
	addressLine2: z.string().max(200).meta(d("Indirizzo (riga 2)")).optional(),
	municipalityId: z.string().min(1).meta(d("ID del comune")).optional(),
	zipCode: z
		.string()
		.regex(/^\d{5}$/)
		.meta(d("CAP italiano (5 cifre)"))
		.optional(),
	country: z.string().min(2).max(2).meta(d("Codice paese")).optional(),
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

export const StoreCategorySchema = z.object({
	id: z.string(),
	macroCategoryId: z
		.string()
		.meta(d("ID della macro categoria di appartenenza")),
	name: z.string().meta(d("Nome della categoria negozio")),
	createdAt: zDate(),
	updatedAt: zDate(),
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

export const EmployeeSchema = z.object({
	id: z.string(),
	sellerProfileId: z.string(),
	userId: z.string(),
	status: z
		.enum(["active", "banned", "removed"])
		.meta(d("Stato del dipendente")),
	createdAt: zDate(),
});

export const CustomerProfileSchema = z.object({
	id: z.string(),
	userId: z.string(),
	points: z.number().min(0).meta({ description: "Saldo punti fedeltà" }),
	createdAt: zDate(),
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
