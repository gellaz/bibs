import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import { CategorySchema, OkMessage, okRes, withErrors } from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	createCategory,
	deleteCategory,
	updateCategory,
} from "../services/categories";

export const categoriesWriteRoutes = new Elysia()
	.post(
		"/categories",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await createCategory(body.name);

			pino.info(
				{
					adminId: user.id,
					categoryId: data.id,
					categoryName: data.name,
					action: "category_created",
				},
				"Categoria prodotto creata",
			);

			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 100, description: "Nome della categoria" }),
			}),
			response: withErrors({ 200: okRes(CategorySchema) }),
			detail: {
				summary: "Crea categoria",
				description:
					"Crea una nuova categoria prodotto. Il nome deve essere univoco.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/categories/:categoryId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await updateCategory({
				categoryId: params.categoryId,
				name: body.name,
			});

			pino.info(
				{
					adminId: user.id,
					categoryId: data.id,
					newName: data.name,
					action: "category_updated",
				},
				"Categoria prodotto aggiornata",
			);

			return ok(data);
		},
		{
			params: t.Object({
				categoryId: t.String({ description: "ID della categoria" }),
			}),
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 100, description: "Nuovo nome della categoria" }),
			}),
			response: withErrors({ 200: okRes(CategorySchema) }),
			detail: {
				summary: "Aggiorna categoria",
				description: "Aggiorna il nome di una categoria prodotto esistente.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/categories/:categoryId",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const deleted = await deleteCategory(params.categoryId);

			pino.info(
				{
					adminId: user.id,
					categoryId: deleted.id,
					categoryName: deleted.name,
					action: "category_deleted",
				},
				"Categoria prodotto eliminata",
			);

			return okMessage("Category deleted");
		},
		{
			params: t.Object({
				categoryId: t.String({ description: "ID della categoria" }),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina categoria",
				description:
					"Elimina una categoria prodotto. Fallisce se la categoria non esiste.",
				tags: ["Admin"],
			},
		},
	);
