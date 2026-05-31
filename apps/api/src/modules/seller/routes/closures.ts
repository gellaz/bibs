import { Elysia, t } from "elysia";
import { ok } from "@/lib/responses";
import {
	okRes,
	PutClosuresBody,
	SellerClosuresResponse,
	withErrors,
} from "@/lib/schemas";
import { requireOwner, withSeller } from "../context";
import { getStoreClosures, putStoreClosures } from "../services/closures";

export const closuresRoutes = new Elysia()
	.get(
		"/stores/:storeId/closures",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params } = withSeller(ctx);
			requireOwner(isOwner);
			const data = await getStoreClosures(params.storeId, sp.id);
			return ok(data);
		},
		{
			params: t.Object({
				storeId: t.String({ description: "ID del negozio" }),
			}),
			response: withErrors({ 200: okRes(SellerClosuresResponse) }),
			detail: {
				summary: "Chiusure negozio",
				description:
					"Festività osservate (con flag observed) e chiusure custom del negozio.",
				tags: ["Seller - Stores"],
			},
		},
	)
	.put(
		"/stores/:storeId/closures",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params, body } = withSeller(ctx);
			requireOwner(isOwner);
			const data = await putStoreClosures({
				storeId: params.storeId,
				sellerProfileId: sp.id,
				...body,
			});
			return ok(data);
		},
		{
			params: t.Object({
				storeId: t.String({ description: "ID del negozio" }),
			}),
			body: PutClosuresBody,
			response: withErrors({ 200: okRes(SellerClosuresResponse) }),
			detail: {
				summary: "Aggiorna chiusure negozio",
				description:
					"Sostituisce per intero gli opt-out festività e le chiusure custom del negozio.",
				tags: ["Seller - Stores"],
			},
		},
	);
