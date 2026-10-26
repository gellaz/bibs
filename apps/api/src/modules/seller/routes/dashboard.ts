import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { ok } from "@/lib/responses";
import { SellerDashboardSchema } from "@/lib/schemas/dashboard";
import { okRes, withErrors } from "@/lib/schemas/responses";
import { ensureStoreAccess } from "../context";
import { getSellerDashboard } from "../services/dashboard";

const DashboardRes = okRes(SellerDashboardSchema);

export const dashboardRoutes = new Hono().get(
	"/dashboard",
	doc({
		response: withErrors({ 200: DashboardRes }),
		detail: {
			summary: "Riepilogo della home venditore",
			description:
				"In una sola risposta i numeri di oggi del negozio (ordini, fatturato lordo, prodotti attivi, promozioni in corso) e le cose da gestire: ordini confermati da preparare, prodotti esauriti o sotto la soglia di scorta bassa del negozio, promozioni che finiscono entro 3 giorni. «Oggi» è il giorno di calendario a Roma. Le promozioni sono del venditore, non del singolo negozio.",
			tags: ["Seller - Dashboard"],
			security: [{ bearerAuth: [] }],
		},
	}),
	v(
		"query",
		z.object({
			storeId: z.string().meta({ description: "ID del negozio attivo" }),
		}),
	),
	requireSeller,
	async (c) => {
		const { storeId } = c.req.valid("query");
		await ensureStoreAccess(storeId, c.var.seller.accessCtx);
		return send(c, DashboardRes, ok(await getSellerDashboard({ storeId })));
	},
);
