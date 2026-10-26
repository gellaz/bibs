import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okMessage, okPage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import {
	AdminProductCategorySchema,
	CategoryCharacteristicLinkSchema,
	CategoryCharacteristicStateSchema,
} from "@/lib/schemas/entities";
import { ProductCategoryListQuery } from "@/lib/schemas/queries";
import {
	OkMessage,
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas/responses";
import { zInteger } from "@/lib/schemas/t";
import { adminDetail } from "../context";
import {
	listAdminProductCategories,
	listCategoryCharacteristics,
	removeCategoryCharacteristic,
	setCategoryCharacteristic,
} from "../services/category-characteristics";

const AdminProductCategoryListResponse = okPageRes(AdminProductCategorySchema);
const CategoryCharacteristicsResponse = okRes(
	z.array(CategoryCharacteristicStateSchema),
);
const CategoryCharacteristicLinkResponse = okRes(
	CategoryCharacteristicLinkSchema,
);

const LinkParams = z.object({
	productCategoryId: z
		.string()
		.meta({ description: "ID della sotto-categoria" }),
	characteristicId: z.string().meta({ description: "ID della caratteristica" }),
});

export const SetCategoryCharacteristicBody = z.object({
	required: z.boolean().meta({ description: "Il venditore deve compilarla" }),
});

export const RemoveCategoryCharacteristicBody = z.object({
	confirmAffected: zInteger({
		minimum: 0,
		description:
			"Numero di prodotti della sotto-categoria con un valore che l'interfaccia ha mostrato nella conferma. Se sono di più, 409 e nulla viene cancellato.",
	}),
});

export const categoryCharacteristicsRoutes = new Hono()
	.get(
		"/product-categories",
		doc({
			response: withErrors({ 200: AdminProductCategoryListResponse }),
			detail: adminDetail(
				"Lista categorie prodotto (admin)",
				"Come la lista pubblica delle sotto-categorie, con in più il numero di caratteristiche assegnate a ciascuna.",
			),
		}),
		v("query", ProductCategoryListQuery),
		requireAdmin,
		async (c) => {
			const result = await listAdminProductCategories(c.req.valid("query"));
			return send(
				c,
				AdminProductCategoryListResponse,
				okPage(result.data, result.pagination),
			);
		},
	)
	.get(
		"/product-categories/:productCategoryId/characteristics",
		doc({
			response: withErrors({ 200: CategoryCharacteristicsResponse }),
			detail: adminDetail(
				"Caratteristiche di una sotto-categoria",
				"Restituisce l'intero dizionario, non paginato, con lo stato di ogni voce per questa sotto-categoria: inclusa, obbligatoria e quanti prodotti della sotto-categoria hanno già un valore. 404 se la sotto-categoria non esiste.",
			),
		}),
		v(
			"param",
			z.object({
				productCategoryId: z
					.string()
					.meta({ description: "ID della sotto-categoria" }),
			}),
		),
		requireAdmin,
		async (c) => {
			const data = await listCategoryCharacteristics(
				c.req.valid("param").productCategoryId,
			);
			return send(c, CategoryCharacteristicsResponse, ok(data));
		},
	)
	.put(
		"/product-categories/:productCategoryId/characteristics/:characteristicId",
		doc({
			response: withConflictErrors({
				200: CategoryCharacteristicLinkResponse,
			}),
			detail: adminDetail(
				"Assegna caratteristica a sotto-categoria",
				"Include la caratteristica nella sotto-categoria (in coda al form del venditore) o, se è già inclusa, ne cambia solo l'obbligatorietà. Idempotente. 404 se sotto-categoria o caratteristica non esistono.",
			),
		}),
		v("param", LinkParams),
		v("json", SetCategoryCharacteristicBody),
		requireAdmin,
		async (c) => {
			const link = await setCategoryCharacteristic({
				...c.req.valid("param"),
				required: c.req.valid("json").required,
			});

			logger.info(
				{
					adminId: c.var.user.id,
					productCategoryId: link.productCategoryId,
					characteristicId: link.characteristicId,
					required: link.required,
					action: "product_category_characteristic_set",
				},
				"Caratteristica assegnata alla sotto-categoria",
			);

			return send(c, CategoryCharacteristicLinkResponse, ok(link));
		},
	)
	.delete(
		"/product-categories/:productCategoryId/characteristics/:characteristicId",
		doc({
			response: withConflictErrors({ 200: OkMessage }),
			detail: adminDetail(
				"Rimuovi caratteristica da sotto-categoria",
				"Toglie la caratteristica dalla sotto-categoria e cancella i valori già compilati sui suoi prodotti; sulle altre sotto-categorie la caratteristica e i suoi valori restano. Richiede confirmAffected (409 altrimenti); 404 se la caratteristica non è assegnata.",
			),
		}),
		v("param", LinkParams),
		v("json", RemoveCategoryCharacteristicBody),
		requireAdmin,
		async (c) => {
			const params = c.req.valid("param");
			const { deletedValues } = await removeCategoryCharacteristic({
				...params,
				confirmAffected: c.req.valid("json").confirmAffected,
			});

			logger.info(
				{
					adminId: c.var.user.id,
					productCategoryId: params.productCategoryId,
					characteristicId: params.characteristicId,
					deletedValues,
					action: "product_category_characteristic_removed",
				},
				"Caratteristica rimossa dalla sotto-categoria",
			);

			return send(
				c,
				OkMessage,
				okMessage("Caratteristica rimossa dalla sotto-categoria"),
			);
		},
	);
