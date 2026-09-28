import { Elysia, t } from "elysia";
import { ok } from "@/lib/responses";
import { okRes, SellerDashboardSchema, withErrors } from "@/lib/schemas";
import { ensureStoreAccess, withSeller } from "../context";
import { getSellerDashboard } from "../services/dashboard";

export const dashboardRoutes = new Elysia().get(
	"/dashboard",
	async (ctx) => {
		const { query, accessCtx } = withSeller(ctx);
		await ensureStoreAccess(query.storeId, accessCtx);
		return ok(await getSellerDashboard({ storeId: query.storeId }));
	},
	{
		query: t.Object({
			storeId: t.String({ description: "ID del negozio attivo" }),
		}),
		response: withErrors({ 200: okRes(SellerDashboardSchema) }),
		detail: {
			summary: "Riepilogo della home venditore",
			description:
				"In una sola risposta i numeri di oggi del negozio (ordini, fatturato lordo, prodotti attivi, promozioni in corso) e le cose da gestire: ordini confermati da preparare, prodotti esauriti o sotto la soglia di scorta bassa del negozio, promozioni che finiscono entro 3 giorni. «Oggi» è il giorno di calendario a Roma. Le promozioni sono del venditore, non del singolo negozio.",
			tags: ["Seller - Dashboard"],
		},
	},
);
