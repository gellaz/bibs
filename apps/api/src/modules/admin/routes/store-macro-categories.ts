import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import { StoreMacroCategorySchema } from "@/lib/zod/entities";
import { OkMessage, okRes, withConflictErrors } from "@/lib/zod/responses";
import { adminDetail } from "../context";
import {
	createStoreMacroCategory,
	deleteStoreMacroCategory,
	updateStoreMacroCategory,
} from "../services/store-macro-categories";

const StoreMacroCategoryResponse = okRes(StoreMacroCategorySchema);

const Params = z.object({
	macroCategoryId: z
		.string()
		.meta({ description: "ID della macro categoria negozio" }),
});

const macroName = (description: string) =>
	z.object({ name: z.string().min(1).max(100).meta({ description }) });

export const storeMacroCategoriesWriteRoutes = new Hono()
	.post(
		"/store-macro-categories",
		doc({
			response: withConflictErrors({ 200: StoreMacroCategoryResponse }),
			detail: adminDetail(
				"Crea macro categoria negozio",
				"Crea una nuova macro categoria negozio. Il nome deve essere univoco.",
			),
		}),
		v("json", macroName("Nome della macro categoria negozio")),
		requireAdmin,
		async (c) => {
			const data = await createStoreMacroCategory(c.req.valid("json").name);

			logger.info(
				{
					adminId: c.var.user.id,
					macroCategoryId: data.id,
					macroCategoryName: data.name,
					action: "store_macro_category_created",
				},
				"Macro categoria negozio creata",
			);

			return send(c, StoreMacroCategoryResponse, ok(data));
		},
	)
	.patch(
		"/store-macro-categories/:macroCategoryId",
		doc({
			response: withConflictErrors({ 200: StoreMacroCategoryResponse }),
			detail: adminDetail(
				"Aggiorna macro categoria negozio",
				"Aggiorna il nome di una macro categoria negozio esistente.",
			),
		}),
		v("param", Params),
		v("json", macroName("Nuovo nome della macro categoria negozio")),
		requireAdmin,
		async (c) => {
			const data = await updateStoreMacroCategory({
				macroCategoryId: c.req.valid("param").macroCategoryId,
				name: c.req.valid("json").name,
			});

			logger.info(
				{
					adminId: c.var.user.id,
					macroCategoryId: data.id,
					newName: data.name,
					action: "store_macro_category_updated",
				},
				"Macro categoria negozio aggiornata",
			);

			return send(c, StoreMacroCategoryResponse, ok(data));
		},
	)
	.delete(
		"/store-macro-categories/:macroCategoryId",
		doc({
			response: withConflictErrors({ 200: OkMessage }),
			detail: adminDetail(
				"Elimina macro categoria negozio",
				"Elimina una macro categoria negozio. Fallisce con 409 se ha ancora categorie collegate.",
			),
		}),
		v("param", Params),
		requireAdmin,
		async (c) => {
			const deleted = await deleteStoreMacroCategory(
				c.req.valid("param").macroCategoryId,
			);

			logger.info(
				{
					adminId: c.var.user.id,
					macroCategoryId: deleted.id,
					macroCategoryName: deleted.name,
					action: "store_macro_category_deleted",
				},
				"Macro categoria negozio eliminata",
			);

			return send(c, OkMessage, okMessage("Macro categoria negozio eliminata"));
		},
	);
