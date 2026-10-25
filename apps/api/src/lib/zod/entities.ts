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
		id: z.string().meta(d("Identificatore univoco del comune")),
		name: z.string().meta(d("Nome del comune")),
		provinceAcronym: z
			.string()
			.min(2)
			.max(2)
			.meta(d("Sigla provincia (2 lettere)")),
	})
	.meta(d("Comune in formato compatto per liste precaricate"));

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
