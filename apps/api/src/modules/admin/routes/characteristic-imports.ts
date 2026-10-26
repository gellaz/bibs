import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import {
	CsvImportWithMissingResultSchema,
	CsvUpsertResultSchema,
} from "@/schemas/entities";
import { okRes, withConflictErrors } from "@/schemas/responses";
import { zFile } from "@/schemas/t";
import { adminDetail } from "../context";
import {
	importCategoryCharacteristicsFromCsv,
	importCharacteristicsFromCsv,
} from "../services/characteristic-import";

const CsvUpsertResponse = okRes(CsvUpsertResultSchema);
const CsvImportWithMissingResponse = okRes(CsvImportWithMissingResultSchema);

// `t.File()` senza `type`: niente controllo dei magic byte (è un CSV).
const csvBody = (description: string) =>
	z.object({ file: zFile({ description }) });

export const characteristicImportsRoutes = new Hono()
	.post(
		"/product-characteristics/import",
		doc({
			response: withConflictErrors({ 200: CsvUpsertResponse }),
			detail: adminDetail(
				"Importa il dizionario delle caratteristiche da CSV",
				"Importa il dizionario delle caratteristiche prodotto in blocco da un file CSV. Colonne attese: name, data_type (text, number, boolean, enum), unit, options (separate da `|`). L'import è in aggiornamento: una caratteristica già presente viene aggiornata (tipo, unità, opzioni) invece di essere saltata.",
			),
		}),
		v("form", csvBody("File CSV con il dizionario delle caratteristiche")),
		requireAdmin,
		async (c) => {
			const csvText = await c.req.valid("form").file.text();
			const result = await importCharacteristicsFromCsv(csvText);

			logger.info(
				{
					adminId: c.var.user.id,
					created: result.created,
					updated: result.updated,
					failed: result.failed,
					action: "product_characteristics_imported",
				},
				"Importazione dizionario caratteristiche da CSV completata",
			);

			return send(c, CsvUpsertResponse, ok(result));
		},
	)
	.post(
		"/product-category-characteristics/import",
		doc({
			response: withConflictErrors({ 200: CsvImportWithMissingResponse }),
			detail: adminDetail(
				"Importa la matrice categoria-caratteristiche da CSV",
				"Importa in blocco da un file CSV quali caratteristiche si applicano a quale sotto-categoria prodotto. Colonne attese: macro_category, subcategory, characteristic, required (true/false). L'import è solo additivo: non cancella mai una riga esistente, ma riporta in `missing` le righe presenti nel database e assenti dal file, raggruppate per sotto-categoria.",
			),
		}),
		v(
			"form",
			csvBody("File CSV con la matrice categoria-caratteristiche da importare"),
		),
		requireAdmin,
		async (c) => {
			const csvText = await c.req.valid("form").file.text();
			const result = await importCategoryCharacteristicsFromCsv(csvText);

			logger.info(
				{
					adminId: c.var.user.id,
					created: result.created,
					skipped: result.skipped,
					failed: result.failed,
					missing: result.missing.length,
					action: "product_category_characteristics_imported",
				},
				"Importazione matrice categoria-caratteristiche da CSV completata",
			);

			return send(c, CsvImportWithMissingResponse, ok(result));
		},
	);
