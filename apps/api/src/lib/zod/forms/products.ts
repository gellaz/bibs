import { z } from "zod";
import { zString } from "../t";

// Gemello Zod di `lib/schemas/forms/products.ts` (D3 del piano Hono). Lo
// schema TypeBox resta per i form del seller FE fino a U11b.

// Aliquote IVA accettate (vedi VAT_RATES in @/lib/vat). Stringhe percentuali;
// `z.union` di letterali per tenere l'ordine in /openapi. Il default lo mette
// anche Elysia, anche in PATCH: si usa con `.optional()`.
export const VatRateSchema = z
	.union([
		z.literal("22"),
		z.literal("10"),
		z.literal("5"),
		z.literal("4"),
		z.literal("0"),
	])
	.meta({ description: "Aliquota IVA (%): 22, 10, 5, 4 o 0" })
	.default("22");

export const CharacteristicValueInputSchema = z.object({
	characteristicId: z.string().meta({ description: "ID della caratteristica" }),
	value: z
		.union([zString({ maxLength: 2000 }), z.number(), z.boolean(), z.null()])
		.meta({
			description:
				"Testo, numero o sì/no secondo il tipo; per le liste chiuse l'ID dell'opzione. null o testo vuoto cancella il valore",
		}),
});

export const CharacteristicValuesField = z
	.array(CharacteristicValueInputSchema)
	.max(300)
	.meta({
		description:
			"Valori delle caratteristiche della sotto-categoria. Una voce con valore aggiorna, una vuota cancella, una caratteristica assente resta com'è",
	});

export const CreateProductBody = z.object({
	name: zString({
		minLength: 1,
		maxLength: 200,
		description: "Nome del prodotto",
		error: "Il nome è obbligatorio",
	}),
	description: zString({
		maxLength: 2000,
		description: "Descrizione del prodotto",
	}).optional(),
	price: z
		.string()
		.regex(/^\d+\.\d{2}$/)
		.meta({
			description: "Prezzo (formato decimale, es. '9.99')",
			error: "Il prezzo deve essere nel formato 0.00",
		}),
	vatRate: VatRateSchema.optional(),
	productCategoryId: z
		.union([z.string(), z.null()])
		.meta({
			description: "ID della sotto-categoria del prodotto (opzionale).",
		})
		.optional(),
	ean: z
		.string()
		.regex(/^$|^(\d{8}|\d{13})$/)
		.meta({
			description:
				"Codice EAN-8 (8 cifre) o EAN-13 (13 cifre). Stringa vuota equivale a omesso.",
			error: "EAN deve essere 8 o 13 cifre",
		})
		.optional(),
	brandId: z
		.string()
		.meta({ description: "ID di un brand esistente del venditore" })
		.optional(),
	brandName: zString({
		minLength: 1,
		maxLength: 120,
		description:
			"Nome di un brand da creare (ignorato se brandId è valorizzato)",
	}).optional(),
	characteristicValues: CharacteristicValuesField.optional(),
	storeId: z.string().meta({
		description:
			"ID del negozio in cui creare il prodotto (autoassegnazione store_products)",
		error: "storeId è obbligatorio",
	}),
});
