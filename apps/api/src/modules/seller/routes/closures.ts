import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import {
	PutClosuresBody,
	SellerClosuresResponse,
} from "@/lib/schemas/holidays";
import { okRes, withErrors } from "@/lib/schemas/responses";
import { requireOwner } from "../context";
import { getStoreClosures, putStoreClosures } from "../services/closures";

const storeId = z.object({
	storeId: z.string().meta({ description: "ID del negozio" }),
});

const ClosuresRes = okRes(SellerClosuresResponse);

export const closuresRoutes = new Hono()
	.get(
		"/stores/:storeId/closures",
		doc({
			response: withErrors({ 200: ClosuresRes }),
			detail: {
				summary: "Chiusure negozio",
				description:
					"Festività osservate (con flag observed) e chiusure custom del negozio.",
				tags: ["Seller - Stores"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("param", storeId),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await getStoreClosures(c.req.valid("param").storeId, sp.id);
			return send(c, ClosuresRes, ok(data));
		},
	)
	.put(
		"/stores/:storeId/closures",
		doc({
			response: withErrors({ 200: ClosuresRes }),
			detail: {
				summary: "Aggiorna chiusure negozio",
				description:
					"Sostituisce per intero gli opt-out festività e le chiusure custom del negozio.",
				tags: ["Seller - Stores"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("param", storeId),
		v("json", PutClosuresBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await putStoreClosures({
				storeId: c.req.valid("param").storeId,
				sellerProfileId: sp.id,
				...c.req.valid("json"),
			});
			return send(c, ClosuresRes, ok(data));
		},
	);
