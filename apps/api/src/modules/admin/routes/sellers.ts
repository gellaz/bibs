import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okPage } from "@/lib/responses";
import {
	okPageRes,
	okRes,
	SellerProfileSchema,
	SellerProfileWithUserSchema,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	listPendingSellers,
	rejectSeller,
	verifySeller,
} from "../services/sellers";

export const sellersRoutes = new Elysia()
	.get(
		"/sellers/pending",
		async ({ query }) => {
			const result = await listPendingSellers(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: PaginationQuery,
			response: withErrors({ 200: okPageRes(SellerProfileWithUserSchema) }),
			detail: {
				summary: "Venditori in attesa di verifica",
				description:
					"Restituisce la lista paginata dei venditori con partita IVA in stato 'pending', inclusi i dati utente.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/sellers/:sellerId/verify",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await verifySeller(params.sellerId);

			pino.info(
				{
					adminId: user.id,
					sellerId: data.id,
					userId: data.userId,
					action: "seller_verified",
				},
				"Venditore verificato",
			);

			return ok(data);
		},
		{
			params: t.Object({
				sellerId: t.String({ description: "ID del profilo venditore" }),
			}),
			response: withErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Verifica venditore",
				description:
					"Approva il venditore e imposta l'onboarding come completato. Abilita il venditore a operare sulla piattaforma.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/sellers/:sellerId/reject",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await rejectSeller(params.sellerId);

			pino.warn(
				{
					adminId: user.id,
					sellerId: data.id,
					userId: data.userId,
					action: "seller_rejected",
				},
				"Venditore rifiutato",
			);

			return ok(data);
		},
		{
			params: t.Object({
				sellerId: t.String({ description: "ID del profilo venditore" }),
			}),
			response: withErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Rifiuta venditore",
				description:
					"Rifiuta il venditore. Il venditore dovrà aggiornare i dati e ripresentare la richiesta.",
				tags: ["Admin"],
			},
		},
	);
