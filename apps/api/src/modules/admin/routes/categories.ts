import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	CategorySchema,
	OkMessage,
	okPageRes,
	okRes,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	createCategory,
	deleteCategory,
	listCategories,
	updateCategory,
} from "../services/categories";

export const categoriesRoutes = new Elysia()
	.get(
		"/categories",
		async ({ query }) => {
			const result = await listCategories(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: PaginationQuery,
			response: withErrors({ 200: okPageRes(CategorySchema) }),
			detail: {
				summary: "Lista categorie prodotto",
				description:
					"Restituisce la lista paginata di tutte le categorie prodotto.",
				tags: ["Admin"],
			},
		},
	)
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
				name: t.String({ description: "Nome della categoria" }),
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
				name: t.String({ description: "Nuovo nome della categoria" }),
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
