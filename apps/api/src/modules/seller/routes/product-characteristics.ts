import { Elysia, t } from "elysia";
import { ok } from "@/lib/responses";
import {
	okRes,
	SellerCategoryCharacteristicSchema,
	withErrors,
} from "@/lib/schemas";
import { getFormCharacteristics } from "../services/product-characteristics";

export const productCharacteristicsRoutes = new Elysia().get(
	"/product-categories/:productCategoryId/characteristics",
	async ({ params }) =>
		ok(await getFormCharacteristics(params.productCategoryId)),
	{
		params: t.Object({
			productCategoryId: t.String({ description: "ID della sotto-categoria" }),
		}),
		response: withErrors({
			200: okRes(t.Array(SellerCategoryCharacteristicSchema)),
		}),
		detail: {
			summary: "Caratteristiche di una sotto-categoria per il form",
			description:
				"Restituisce, non paginate, le caratteristiche previste per la sotto-categoria, nell'ordine del form (posizione, poi nome), con le opzioni delle liste chiuse. 404 se la sotto-categoria non esiste.",
			tags: ["Seller - Products"],
		},
	},
);
