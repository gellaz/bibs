import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	OkMessage,
	okRes,
	ProductCategorySchema,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	createProductCategory,
	deleteProductCategory,
	updateProductCategory,
} from "../services/product-categories";

export const productCategoriesWriteRoutes = new Elysia()
	.post(
		"/product-categories",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await createProductCategory({
				name: body.name,
				macroCategoryId: body.macroCategoryId,
			});

			pino.info(
				{
					adminId: user.id,
					categoryId: data.id,
					categoryName: data.name,
					macroCategoryId: data.macroCategoryId,
					action: "product_category_created",
				},
				"Categoria prodotto creata",
			);

			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nome della sotto-categoria",
				}),
				macroCategoryId: t.String({
					minLength: 1,
					description: "ID della macro categoria di appartenenza",
				}),
			}),
			response: withErrors({ 200: okRes(ProductCategorySchema) }),
			detail: {
				summary: "Crea categoria prodotto",
				description:
					"Crea una nuova sotto-categoria prodotto sotto una macro categoria. Il nome deve essere univoco all'interno della stessa macro.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/product-categories/:productCategoryId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await updateProductCategory({
				productCategoryId: params.productCategoryId,
				name: body.name,
				macroCategoryId: body.macroCategoryId,
			});

			pino.info(
				{
					adminId: user.id,
					categoryId: data.id,
					newName: data.name,
					newMacroCategoryId: data.macroCategoryId,
					action: "product_category_updated",
				},
				"Categoria prodotto aggiornata",
			);

			return ok(data);
		},
		{
			params: t.Object({
				productCategoryId: t.String({
					description: "ID della categoria prodotto",
				}),
			}),
			body: t.Object({
				name: t.Optional(
					t.String({
						minLength: 1,
						maxLength: 100,
						description: "Nuovo nome della sotto-categoria",
					}),
				),
				macroCategoryId: t.Optional(
					t.String({
						minLength: 1,
						description: "Nuovo ID della macro categoria di appartenenza",
					}),
				),
			}),
			response: withErrors({ 200: okRes(ProductCategorySchema) }),
			detail: {
				summary: "Aggiorna categoria prodotto",
				description:
					"Aggiorna nome e/o macro categoria di una sotto-categoria prodotto esistente.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/product-categories/:productCategoryId",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const deleted = await deleteProductCategory(params.productCategoryId);

			pino.info(
				{
					adminId: user.id,
					categoryId: deleted.id,
					categoryName: deleted.name,
					action: "product_category_deleted",
				},
				"Categoria prodotto eliminata",
			);

			return okMessage("Product category deleted");
		},
		{
			params: t.Object({
				productCategoryId: t.String({
					description: "ID della categoria prodotto",
				}),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina categoria prodotto",
				description:
					"Elimina una sotto-categoria prodotto. Fallisce se la categoria non esiste.",
				tags: ["Admin"],
			},
		},
	);
