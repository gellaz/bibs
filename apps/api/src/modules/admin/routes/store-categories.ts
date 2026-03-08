import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	OkMessage,
	okRes,
	StoreCategorySchema,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	createStoreCategory,
	deleteStoreCategory,
	updateStoreCategory,
} from "../services/store-categories";

export const storeCategoriesWriteRoutes = new Elysia()
	.post(
		"/store-categories",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await createStoreCategory(body.name);

			pino.info(
				{
					adminId: user.id,
					storeCategoryId: data.id,
					storeCategoryName: data.name,
					action: "store_category_created",
				},
				"Categoria negozio creata",
			);

			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nome della categoria negozio",
				}),
			}),
			response: withErrors({ 200: okRes(StoreCategorySchema) }),
			detail: {
				summary: "Crea categoria negozio",
				description:
					"Crea una nuova categoria negozio. Il nome deve essere univoco.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/store-categories/:categoryId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await updateStoreCategory({
				categoryId: params.categoryId,
				name: body.name,
			});

			pino.info(
				{
					adminId: user.id,
					storeCategoryId: data.id,
					newName: data.name,
					action: "store_category_updated",
				},
				"Categoria negozio aggiornata",
			);

			return ok(data);
		},
		{
			params: t.Object({
				categoryId: t.String({ description: "ID della categoria negozio" }),
			}),
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nuovo nome della categoria negozio",
				}),
			}),
			response: withErrors({ 200: okRes(StoreCategorySchema) }),
			detail: {
				summary: "Aggiorna categoria negozio",
				description: "Aggiorna il nome di una categoria negozio esistente.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/store-categories/:categoryId",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const deleted = await deleteStoreCategory(params.categoryId);

			pino.info(
				{
					adminId: user.id,
					storeCategoryId: deleted.id,
					storeCategoryName: deleted.name,
					action: "store_category_deleted",
				},
				"Categoria negozio eliminata",
			);

			return okMessage("Store category deleted");
		},
		{
			params: t.Object({
				categoryId: t.String({ description: "ID della categoria negozio" }),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina categoria negozio",
				description:
					"Elimina una categoria negozio. Fallisce se la categoria non esiste.",
				tags: ["Admin"],
			},
		},
	);
