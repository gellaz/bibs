import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okMessage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { ProductCategorySchema } from "@/schemas/entities";
import { OkMessage, okRes, withConflictErrors } from "@/schemas/responses";
import { zString } from "@/schemas/t";
import { adminDetail } from "../context";
import {
	createProductCategory,
	deleteProductCategory,
	updateProductCategory,
} from "../services/product-categories";

const ProductCategoryResponse = okRes(ProductCategorySchema);

const Params = z.object({
	productCategoryId: z
		.string()
		.meta({ description: "ID della categoria prodotto" }),
});

export const productCategoriesWriteRoutes = new Hono()
	.post(
		"/product-categories",
		doc({
			response: withConflictErrors({ 200: ProductCategoryResponse }),
			detail: adminDetail(
				"Crea categoria prodotto",
				"Crea una nuova sotto-categoria prodotto sotto una macro categoria. Il nome deve essere univoco all'interno della stessa macro.",
			),
		}),
		v(
			"json",
			z.object({
				name: zString({
					minLength: 1,
					maxLength: 100,
					description: "Nome della sotto-categoria",
				}),
				macroCategoryId: zString({
					minLength: 1,
					description: "ID della macro categoria di appartenenza",
				}),
			}),
		),
		requireAdmin,
		async (c) => {
			const body = c.req.valid("json");
			const data = await createProductCategory({
				name: body.name,
				macroCategoryId: body.macroCategoryId,
			});

			logger.info(
				{
					adminId: c.var.user.id,
					categoryId: data.id,
					categoryName: data.name,
					macroCategoryId: data.macroCategoryId,
					action: "product_category_created",
				},
				"Categoria prodotto creata",
			);

			return send(c, ProductCategoryResponse, ok(data));
		},
	)
	.patch(
		"/product-categories/:productCategoryId",
		doc({
			response: withConflictErrors({ 200: ProductCategoryResponse }),
			detail: adminDetail(
				"Aggiorna categoria prodotto",
				"Aggiorna nome e/o macro categoria di una sotto-categoria prodotto esistente.",
			),
		}),
		v("param", Params),
		v(
			"json",
			z.object({
				name: zString({
					minLength: 1,
					maxLength: 100,
					description: "Nuovo nome della sotto-categoria",
				}).optional(),
				macroCategoryId: zString({
					minLength: 1,
					description: "Nuovo ID della macro categoria di appartenenza",
				}).optional(),
			}),
		),
		requireAdmin,
		async (c) => {
			const body = c.req.valid("json");
			const data = await updateProductCategory({
				productCategoryId: c.req.valid("param").productCategoryId,
				name: body.name,
				macroCategoryId: body.macroCategoryId,
			});

			logger.info(
				{
					adminId: c.var.user.id,
					categoryId: data.id,
					newName: data.name,
					newMacroCategoryId: data.macroCategoryId,
					action: "product_category_updated",
				},
				"Categoria prodotto aggiornata",
			);

			return send(c, ProductCategoryResponse, ok(data));
		},
	)
	.delete(
		"/product-categories/:productCategoryId",
		doc({
			response: withConflictErrors({ 200: OkMessage }),
			detail: adminDetail(
				"Elimina categoria prodotto",
				"Elimina una sotto-categoria prodotto. Fallisce se la categoria non esiste (404) o se ci sono prodotti collegati (409).",
			),
		}),
		v("param", Params),
		requireAdmin,
		async (c) => {
			const deleted = await deleteProductCategory(
				c.req.valid("param").productCategoryId,
			);

			logger.info(
				{
					adminId: c.var.user.id,
					categoryId: deleted.id,
					categoryName: deleted.name,
					action: "product_category_deleted",
				},
				"Categoria prodotto eliminata",
			);

			return send(c, OkMessage, okMessage("Sotto-categoria eliminata"));
		},
	);
