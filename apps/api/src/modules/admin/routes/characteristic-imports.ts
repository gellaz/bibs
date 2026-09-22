import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import {
	CsvImportResultSchema,
	okRes,
	withConflictErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import { importCharacteristicsFromCsv } from "../services/characteristic-import";

export const characteristicImportsRoutes = new Elysia().post(
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
				skipped: result.skipped,
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
		response: withConflictErrors({ 200: okRes(CsvImportResultSchema) }),
		detail: {
			summary: "Importa il dizionario delle caratteristiche da CSV",
			description:
				"Importa il dizionario delle caratteristiche prodotto in blocco da un file CSV. Colonne attese: name, data_type (text, number, boolean, enum), unit, options (separate da `|`). L'import è in aggiornamento: una caratteristica già presente viene aggiornata (tipo, unità, opzioni) invece di essere saltata.",
			tags: ["Admin"],
		},
	},
);
