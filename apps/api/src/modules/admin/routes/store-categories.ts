import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okMessage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { StoreCategorySchema } from "@/schemas/entities";
import {
	OkMessage,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/schemas/responses";
import { zString } from "@/schemas/t";
import { adminDetail } from "../context";
import {
	createStoreCategory,
	deleteStoreCategory,
	updateStoreCategory,
} from "../services/store-categories";

const StoreCategoryResponse = okRes(StoreCategorySchema);

const Params = z.object({
	categoryId: z.string().meta({ description: "ID della categoria negozio" }),
});

export const storeCategoriesWriteRoutes = new Hono()
	.post(
		"/store-categories",
		doc({
			response: withConflictErrors({ 200: StoreCategoryResponse }),
			detail: adminDetail(
				"Crea categoria negozio",
				"Crea una nuova categoria negozio. Il nome deve essere univoco.",
			),
		}),
		v(
			"json",
			z.object({
				name: zString({
					minLength: 1,
					maxLength: 100,
					description: "Nome della categoria negozio",
				}),
				macroCategoryId: z
					.string()
					.meta({ description: "ID della macro categoria di appartenenza" }),
			}),
		),
		requireAdmin,
		async (c) => {
			const body = c.req.valid("json");
			const data = await createStoreCategory({
				name: body.name,
				macroCategoryId: body.macroCategoryId,
			});

			logger.info(
				{
					adminId: c.var.user.id,
					storeCategoryId: data.id,
					storeCategoryName: data.name,
					macroCategoryId: data.macroCategoryId,
					action: "store_category_created",
				},
				"Categoria negozio creata",
			);

			return send(c, StoreCategoryResponse, ok(data));
		},
	)
	.patch(
		"/store-categories/:categoryId",
		doc({
			response: withConflictErrors({ 200: StoreCategoryResponse }),
			detail: adminDetail(
				"Aggiorna categoria negozio",
				"Aggiorna nome e/o macro categoria di una categoria negozio esistente.",
			),
		}),
		v("param", Params),
		v(
			"json",
			z.object({
				name: zString({
					minLength: 1,
					maxLength: 100,
					description: "Nuovo nome della categoria negozio",
				}).optional(),
				macroCategoryId: z
					.string()
					.meta({ description: "Nuova macro categoria di appartenenza" })
					.optional(),
			}),
		),
		requireAdmin,
		async (c) => {
			const body = c.req.valid("json");
			const data = await updateStoreCategory({
				categoryId: c.req.valid("param").categoryId,
				name: body.name,
				macroCategoryId: body.macroCategoryId,
			});

			logger.info(
				{
					adminId: c.var.user.id,
					storeCategoryId: data.id,
					newName: data.name,
					newMacroCategoryId: data.macroCategoryId,
					action: "store_category_updated",
				},
				"Categoria negozio aggiornata",
			);

			return send(c, StoreCategoryResponse, ok(data));
		},
	)
	.delete(
		"/store-categories/:categoryId",
		doc({
			response: withErrors({ 200: OkMessage }),
			detail: adminDetail(
				"Elimina categoria negozio",
				"Elimina una categoria negozio. Fallisce se la categoria non esiste.",
			),
		}),
		v("param", Params),
		requireAdmin,
		async (c) => {
			const deleted = await deleteStoreCategory(
				c.req.valid("param").categoryId,
			);

			logger.info(
				{
					adminId: c.var.user.id,
					storeCategoryId: deleted.id,
					storeCategoryName: deleted.name,
					action: "store_category_deleted",
				},
				"Categoria negozio eliminata",
			);

			return send(c, OkMessage, okMessage("Categoria negozio eliminata"));
		},
	);
