import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	OkMessage,
	okRes,
	ProductMacroCategorySchema,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	createProductMacroCategory,
	deleteProductMacroCategory,
	updateProductMacroCategory,
} from "../services/product-macro-categories";

export const productMacroCategoriesWriteRoutes = new Elysia()
	.post(
		"/product-macro-categories",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await createProductMacroCategory(body.name);

			pino.info(
				{
					adminId: user.id,
					macroCategoryId: data.id,
					macroCategoryName: data.name,
					action: "product_macro_category_created",
				},
				"Macro categoria prodotto creata",
			);

			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nome della macro categoria",
				}),
			}),
			response: withErrors({ 200: okRes(ProductMacroCategorySchema) }),
			detail: {
				summary: "Crea macro categoria prodotto",
				description:
					"Crea una nuova macro categoria prodotto. Il nome deve essere univoco.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/product-macro-categories/:macroCategoryId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await updateProductMacroCategory({
				macroCategoryId: params.macroCategoryId,
				name: body.name,
			});

			pino.info(
				{
					adminId: user.id,
					macroCategoryId: data.id,
					newName: data.name,
					action: "product_macro_category_updated",
				},
				"Macro categoria prodotto aggiornata",
			);

			return ok(data);
		},
		{
			params: t.Object({
				macroCategoryId: t.String({
					description: "ID della macro categoria prodotto",
				}),
			}),
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nuovo nome della macro categoria",
				}),
			}),
			response: withErrors({ 200: okRes(ProductMacroCategorySchema) }),
			detail: {
				summary: "Aggiorna macro categoria prodotto",
				description:
					"Aggiorna il nome di una macro categoria prodotto esistente.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/product-macro-categories/:macroCategoryId",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const deleted = await deleteProductMacroCategory(params.macroCategoryId);

			pino.info(
				{
					adminId: user.id,
					macroCategoryId: deleted.id,
					macroCategoryName: deleted.name,
					action: "product_macro_category_deleted",
				},
				"Macro categoria prodotto eliminata",
			);

			return okMessage("Product macro category deleted");
		},
		{
			params: t.Object({
				macroCategoryId: t.String({
					description: "ID della macro categoria prodotto",
				}),
			}),
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina macro categoria prodotto",
				description:
					"Elimina una macro categoria prodotto. Fallisce con 409 se ci sono sotto-categorie collegate.",
				tags: ["Admin"],
			},
		},
	);
