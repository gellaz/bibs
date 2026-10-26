import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import { CsvImportResultSchema } from "@/lib/schemas/entities";
import { okRes, withConflictErrors } from "@/lib/schemas/responses";
import { zFile } from "@/lib/schemas/t";
import { adminDetail } from "../context";
import {
	importProductCategoriesFromCsv,
	importStoreCategoriesFromCsv,
} from "../services/category-import";

const CsvImportResponse = okRes(CsvImportResultSchema);

// `t.File()` senza `type`: niente controllo dei magic byte (è un CSV).
const csvBody = (description: string) =>
	z.object({ file: zFile({ description }) });

export const categoryImportsRoutes = new Hono()
	.post(
		"/product-categories/import",
		doc({
			response: withConflictErrors({ 200: CsvImportResponse }),
			detail: adminDetail(
				"Importa categorie prodotto da CSV",
				"Importa categorie prodotto in blocco da un file CSV. Colonne attese: macro_category, subcategory. L'import è idempotente: le categorie già presenti vengono saltate.",
			),
		}),
		v("form", csvBody("File CSV con le categorie prodotto da importare")),
		requireAdmin,
		async (c) => {
			const csvText = await c.req.valid("form").file.text();
			const result = await importProductCategoriesFromCsv(csvText);

			logger.info(
				{
					adminId: c.var.user.id,
					created: result.created,
					skipped: result.skipped,
					failed: result.failed,
					action: "product_categories_imported",
				},
				"Importazione categorie prodotto da CSV completata",
			);

			return send(c, CsvImportResponse, ok(result));
		},
	)
	.post(
		"/store-categories/import",
		doc({
			response: withConflictErrors({ 200: CsvImportResponse }),
			detail: adminDetail(
				"Importa categorie negozio da CSV",
				"Importa categorie negozio in blocco da un file CSV. Colonna attesa: name. L'import è idempotente: le categorie già presenti vengono saltate.",
			),
		}),
		v("form", csvBody("File CSV con le categorie negozio da importare")),
		requireAdmin,
		async (c) => {
			const csvText = await c.req.valid("form").file.text();
			const result = await importStoreCategoriesFromCsv(csvText);

			logger.info(
				{
					adminId: c.var.user.id,
					created: result.created,
					skipped: result.skipped,
					failed: result.failed,
					action: "store_categories_imported",
				},
				"Importazione categorie negozio da CSV completata",
			);

			return send(c, CsvImportResponse, ok(result));
		},
	);
