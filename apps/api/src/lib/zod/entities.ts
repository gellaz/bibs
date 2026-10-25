import { z } from "zod";
import { zDate, zInteger } from "./t";

// Gemelli Zod di `lib/schemas/entities.ts` (D3 del piano Hono), nello stesso
// ordine e con gli stessi nomi; ogni unità aggiunge quelli delle sue route.
// Un'unione di letterali numerici (aliquote IVA) è `z.union` di `z.literal`:
// `z.enum` riordina le chiavi numeriche e cambierebbe l'ordine in /openapi.

const d = (description: string) => ({ description });

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
