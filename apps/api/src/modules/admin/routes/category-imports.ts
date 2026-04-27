import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import { CsvImportResultSchema, okRes, withErrors } from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	importProductCategoriesFromCsv,
	importStoreCategoriesFromCsv,
} from "../services/category-import";

export const categoryImportsRoutes = new Elysia()
	.post(
		"/product-categories/import",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const csvText = await body.file.text();
			const result = await importProductCategoriesFromCsv(csvText);

			pino.info(
				{
					adminId: user.id,
					created: result.created,
					skipped: result.skipped,
					failed: result.failed,
					action: "product_categories_imported",
				},
				"Importazione categorie prodotto da CSV completata",
			);

			return ok(result);
		},
		{
			body: t.Object({
				file: t.File({
					description: "File CSV con le categorie prodotto da importare",
				}),
			}),
			response: withErrors({ 200: okRes(CsvImportResultSchema) }),
			detail: {
				summary: "Importa categorie prodotto da CSV",
				description:
					"Importa categorie prodotto in blocco da un file CSV. Colonne attese: macro_category, subcategory. L'import è idempotente: le categorie già presenti vengono saltate.",
				tags: ["Admin"],
			},
		},
	)
	.post(
		"/store-categories/import",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const csvText = await body.file.text();
			const result = await importStoreCategoriesFromCsv(csvText);

			pino.info(
				{
					adminId: user.id,
					created: result.created,
					skipped: result.skipped,
					failed: result.failed,
					action: "store_categories_imported",
				},
				"Importazione categorie negozio da CSV completata",
			);

			return ok(result);
		},
		{
			body: t.Object({
				file: t.File({
					description: "File CSV con le categorie negozio da importare",
				}),
			}),
			response: withErrors({ 200: okRes(CsvImportResultSchema) }),
			detail: {
				summary: "Importa categorie negozio da CSV",
				description:
					"Importa categorie negozio in blocco da un file CSV. Colonna attesa: name. L'import è idempotente: le categorie già presenti vengono saltate.",
				tags: ["Admin"],
			},
		},
	);
