import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import { ProductMacroCategorySchema } from "@/lib/schemas/entities";
import { VatRateSchema } from "@/lib/schemas/forms/products";
import { OkMessage, okRes, withConflictErrors } from "@/lib/schemas/responses";
import { zString } from "@/lib/schemas/t";
import { adminDetail } from "../context";
import {
	createProductMacroCategory,
	deleteProductMacroCategory,
	updateProductMacroCategory,
} from "../services/product-macro-categories";

const ProductMacroCategoryResponse = okRes(ProductMacroCategorySchema);

const Params = z.object({
	macroCategoryId: z
		.string()
		.meta({ description: "ID della macro categoria prodotto" }),
});

const macroName = (description: string) =>
	zString({ minLength: 1, maxLength: 100, description });

export const CreateProductMacroCategoryBody = z.object({
	name: macroName("Nome della macro categoria"),
	suggestedVatRate: VatRateSchema.optional(),
});

export const productMacroCategoriesWriteRoutes = new Hono()
	.post(
		"/product-macro-categories",
		doc({
			response: withConflictErrors({ 200: ProductMacroCategoryResponse }),
			detail: adminDetail(
				"Crea macro categoria prodotto",
				"Crea una nuova macro categoria prodotto. Il nome deve essere univoco.",
			),
		}),
		v("json", CreateProductMacroCategoryBody),
		requireAdmin,
		async (c) => {
			const body = c.req.valid("json");
			const data = await createProductMacroCategory({
				name: body.name,
				suggestedVatRate: body.suggestedVatRate,
			});

			logger.info(
				{
					adminId: c.var.user.id,
					macroCategoryId: data.id,
					macroCategoryName: data.name,
					action: "product_macro_category_created",
				},
				"Macro categoria prodotto creata",
			);

			return send(c, ProductMacroCategoryResponse, ok(data));
		},
	)
	.patch(
		"/product-macro-categories/:macroCategoryId",
		doc({
			response: withConflictErrors({ 200: ProductMacroCategoryResponse }),
			detail: adminDetail(
				"Aggiorna macro categoria prodotto",
				"Aggiorna il nome di una macro categoria prodotto esistente.",
			),
		}),
		v("param", Params),
		v(
			"json",
			z.object({
				name: macroName("Nuovo nome della macro categoria"),
				suggestedVatRate: VatRateSchema.optional(),
			}),
		),
		requireAdmin,
		async (c) => {
			const body = c.req.valid("json");
			const data = await updateProductMacroCategory({
				macroCategoryId: c.req.valid("param").macroCategoryId,
				name: body.name,
				suggestedVatRate: body.suggestedVatRate,
			});

			logger.info(
				{
					adminId: c.var.user.id,
					macroCategoryId: data.id,
					newName: data.name,
					action: "product_macro_category_updated",
				},
				"Macro categoria prodotto aggiornata",
			);

			return send(c, ProductMacroCategoryResponse, ok(data));
		},
	)
	.delete(
		"/product-macro-categories/:macroCategoryId",
		doc({
			response: withConflictErrors({ 200: OkMessage }),
			detail: adminDetail(
				"Elimina macro categoria prodotto",
				"Elimina una macro categoria prodotto. Fallisce con 409 se ci sono sotto-categorie collegate.",
			),
		}),
		v("param", Params),
		requireAdmin,
		async (c) => {
			const deleted = await deleteProductMacroCategory(
				c.req.valid("param").macroCategoryId,
			);

			logger.info(
				{
					adminId: c.var.user.id,
					macroCategoryId: deleted.id,
					macroCategoryName: deleted.name,
					action: "product_macro_category_deleted",
				},
				"Macro categoria prodotto eliminata",
			);

			return send(
				c,
				OkMessage,
				okMessage("Macro categoria prodotto eliminata"),
			);
		},
	);
