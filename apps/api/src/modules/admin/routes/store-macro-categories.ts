import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	OkMessage,
	okRes,
	StoreMacroCategorySchema,
	withConflictErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	createStoreMacroCategory,
	deleteStoreMacroCategory,
	updateStoreMacroCategory,
} from "../services/store-macro-categories";

export const storeMacroCategoriesWriteRoutes = new Elysia()
	.post(
		"/store-macro-categories",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await createStoreMacroCategory(body.name);

			pino.info(
				{
					adminId: user.id,
					macroCategoryId: data.id,
					macroCategoryName: data.name,
					action: "store_macro_category_created",
				},
				"Macro categoria negozio creata",
			);

			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nome della macro categoria negozio",
				}),
			}),
			response: withConflictErrors({ 200: okRes(StoreMacroCategorySchema) }),
			detail: {
				summary: "Crea macro categoria negozio",
				description:
					"Crea una nuova macro categoria negozio. Il nome deve essere univoco.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/store-macro-categories/:macroCategoryId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await updateStoreMacroCategory({
				macroCategoryId: params.macroCategoryId,
				name: body.name,
			});

			pino.info(
				{
					adminId: user.id,
					macroCategoryId: data.id,
					newName: data.name,
					action: "store_macro_category_updated",
				},
				"Macro categoria negozio aggiornata",
			);

			return ok(data);
		},
		{
			params: t.Object({
				macroCategoryId: t.String({
					description: "ID della macro categoria negozio",
				}),
			}),
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nuovo nome della macro categoria negozio",
				}),
			}),
			response: withConflictErrors({ 200: okRes(StoreMacroCategorySchema) }),
			detail: {
				summary: "Aggiorna macro categoria negozio",
				description:
					"Aggiorna il nome di una macro categoria negozio esistente.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/store-macro-categories/:macroCategoryId",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const deleted = await deleteStoreMacroCategory(params.macroCategoryId);

			pino.info(
				{
					adminId: user.id,
					macroCategoryId: deleted.id,
					macroCategoryName: deleted.name,
					action: "store_macro_category_deleted",
				},
				"Macro categoria negozio eliminata",
			);

			return okMessage("Store macro category deleted");
		},
		{
			params: t.Object({
				macroCategoryId: t.String({
					description: "ID della macro categoria negozio",
				}),
			}),
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina macro categoria negozio",
				description:
					"Elimina una macro categoria negozio. Fallisce con 409 se ha ancora categorie collegate.",
				tags: ["Admin"],
			},
		},
	);
