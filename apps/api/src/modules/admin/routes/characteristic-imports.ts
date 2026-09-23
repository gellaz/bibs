import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import {
	CsvImportWithMissingResultSchema,
	CsvUpsertResultSchema,
	okRes,
	withConflictErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	importCategoryCharacteristicsFromCsv,
	importCharacteristicsFromCsv,
} from "../services/characteristic-import";

export const characteristicImportsRoutes = new Elysia()
	.post(
		"/product-characteristics/import",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const csvText = await body.file.text();
			const result = await importCharacteristicsFromCsv(csvText);

			pino.info(
				{
					adminId: user.id,
					created: result.created,
					updated: result.updated,
					failed: result.failed,
					action: "product_characteristics_imported",
				},
				"Importazione dizionario caratteristiche da CSV completata",
			);

			return ok(result);
		},
		{
			body: t.Object({
				file: t.File({
					description: "File CSV con il dizionario delle caratteristiche",
				}),
			}),
			response: withConflictErrors({ 200: okRes(CsvUpsertResultSchema) }),
			detail: {
				summary: "Importa il dizionario delle caratteristiche da CSV",
				description:
					"Importa il dizionario delle caratteristiche prodotto in blocco da un file CSV. Colonne attese: name, data_type (text, number, boolean, enum), unit, options (separate da `|`). L'import è in aggiornamento: una caratteristica già presente viene aggiornata (tipo, unità, opzioni) invece di essere saltata.",
				tags: ["Admin"],
			},
		},
	)
	.post(
		"/product-category-characteristics/import",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const csvText = await body.file.text();
			const result = await importCategoryCharacteristicsFromCsv(csvText);

			pino.info(
				{
					adminId: user.id,
					created: result.created,
					skipped: result.skipped,
					failed: result.failed,
					missing: result.missing.length,
					action: "product_category_characteristics_imported",
				},
				"Importazione matrice categoria-caratteristiche da CSV completata",
			);

			return ok(result);
		},
		{
			body: t.Object({
				file: t.File({
					description:
						"File CSV con la matrice categoria-caratteristiche da importare",
				}),
			}),
			response: withConflictErrors({
				200: okRes(CsvImportWithMissingResultSchema),
			}),
			detail: {
				summary: "Importa la matrice categoria-caratteristiche da CSV",
				description:
					"Importa in blocco da un file CSV quali caratteristiche si applicano a quale sotto-categoria prodotto. Colonne attese: macro_category, subcategory, characteristic, required (true/false). L'import è solo additivo: non cancella mai una riga esistente, ma riporta in `missing` le righe presenti nel database e assenti dal file, raggruppate per sotto-categoria.",
				tags: ["Admin"],
			},
		},
	);
