import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { SellerCategoryCharacteristicSchema } from "@/lib/schemas/entities";
import { okRes, withErrors } from "@/lib/schemas/responses";
import { getFormCharacteristics } from "../services/product-characteristics";

const Params = z.object({
	productCategoryId: z
		.string()
		.meta({ description: "ID della sotto-categoria" }),
});

const CharacteristicsRes = okRes(z.array(SellerCategoryCharacteristicSchema));

export const productCharacteristicsRoutes = new Hono().get(
	"/product-categories/:productCategoryId/characteristics",
	doc({
		response: withErrors({ 200: CharacteristicsRes }),
		detail: {
			summary: "Caratteristiche di una sotto-categoria per il form",
			description:
				"Restituisce, non paginate, le caratteristiche previste per la sotto-categoria, nell'ordine del form (posizione, poi nome), con le opzioni delle liste chiuse. 404 se la sotto-categoria non esiste.",
			tags: ["Seller - Products"],
			security: [{ bearerAuth: [] }],
		},
	}),
	v("param", Params),
	requireSeller,
	async (c) =>
		send(
			c,
			CharacteristicsRes,
			ok(await getFormCharacteristics(c.req.valid("param").productCategoryId)),
		),
);
