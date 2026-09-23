import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ProductCategoryListQuery } from "@/lib/queries";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	AdminProductCategorySchema,
	CategoryCharacteristicLinkSchema,
	CategoryCharacteristicStateSchema,
	OkMessage,
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	listAdminProductCategories,
	listCategoryCharacteristics,
	removeCategoryCharacteristic,
	setCategoryCharacteristic,
} from "../services/category-characteristics";

const LinkParams = t.Object({
	productCategoryId: t.String({ description: "ID della sotto-categoria" }),
	characteristicId: t.String({ description: "ID della caratteristica" }),
});

export const categoryCharacteristicsRoutes = new Elysia()
	.get(
		"/product-categories",
		async ({ query }) => {
			const result = await listAdminProductCategories(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: ProductCategoryListQuery,
			response: withErrors({ 200: okPageRes(AdminProductCategorySchema) }),
			detail: {
				summary: "Lista categorie prodotto (admin)",
				description:
					"Come la lista pubblica delle sotto-categorie, con in più il numero di caratteristiche assegnate a ciascuna.",
				tags: ["Admin"],
			},
		},
	)
	.get(
		"/product-categories/:productCategoryId/characteristics",
		async ({ params }) => {
			const data = await listCategoryCharacteristics(params.productCategoryId);
			return ok(data);
		},
		{
			params: t.Object({
				productCategoryId: t.String({
					description: "ID della sotto-categoria",
				}),
			}),
			response: withErrors({
				200: okRes(t.Array(CategoryCharacteristicStateSchema)),
			}),
			detail: {
				summary: "Caratteristiche di una sotto-categoria",
				description:
					"Restituisce l'intero dizionario, non paginato, con lo stato di ogni voce per questa sotto-categoria: inclusa, obbligatoria e quanti prodotti della sotto-categoria hanno già un valore. 404 se la sotto-categoria non esiste.",
				tags: ["Admin"],
			},
		},
	)
	.put(
		"/product-categories/:productCategoryId/characteristics/:characteristicId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const link = await setCategoryCharacteristic({
				...params,
				required: body.required,
			});

			getLogger(store).info(
				{
					adminId: user.id,
					productCategoryId: link.productCategoryId,
					characteristicId: link.characteristicId,
					required: link.required,
					action: "product_category_characteristic_set",
				},
				"Caratteristica assegnata alla sotto-categoria",
			);

			return ok(link);
		},
		{
			params: LinkParams,
			body: t.Object({
				required: t.Boolean({ description: "Il venditore deve compilarla" }),
			}),
			response: withConflictErrors({
				200: okRes(CategoryCharacteristicLinkSchema),
			}),
			detail: {
				summary: "Assegna caratteristica a sotto-categoria",
				description:
					"Include la caratteristica nella sotto-categoria (in coda al form del venditore) o, se è già inclusa, ne cambia solo l'obbligatorietà. Idempotente. 404 se sotto-categoria o caratteristica non esistono.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/product-categories/:productCategoryId/characteristics/:characteristicId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const { deletedValues } = await removeCategoryCharacteristic({
				...params,
				confirmAffected: body.confirmAffected,
			});

			getLogger(store).info(
				{
					adminId: user.id,
					productCategoryId: params.productCategoryId,
					characteristicId: params.characteristicId,
					deletedValues,
					action: "product_category_characteristic_removed",
				},
				"Caratteristica rimossa dalla sotto-categoria",
			);

			return okMessage("Characteristic removed from product category");
		},
		{
			params: LinkParams,
			body: t.Object({
				confirmAffected: t.Integer({
					minimum: 0,
					description:
						"Numero di prodotti della sotto-categoria con un valore che l'interfaccia ha mostrato nella conferma. Se sono di più, 409 e nulla viene cancellato.",
				}),
			}),
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi caratteristica da sotto-categoria",
				description:
					"Toglie la caratteristica dalla sotto-categoria e cancella i valori già compilati sui suoi prodotti; sulle altre sotto-categorie la caratteristica e i suoi valori restano. Richiede confirmAffected (409 altrimenti); 404 se la caratteristica non è assegnata.",
				tags: ["Admin"],
			},
		},
	);
