import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { SellerListQuery } from "@/lib/queries";
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
	countSellersByStatus,
	getSellerDetail,
	listSellers,
	rejectSeller,
	verifySeller,
} from "../services/sellers";

export const sellersRoutes = new Elysia()
	.get(
		"/sellers/counts",
		async () => {
			const data = await countSellersByStatus();
			return ok(data);
		},
		{
			response: withErrors({
				200: okRes(
					t.Object({
						pending_review: t.Number(),
						active: t.Number(),
						rejected: t.Number(),
					}),
				),
			}),
			detail: {
				summary: "Contatori venditori per stato",
				description:
					"Restituisce il numero di venditori per ogni stato di onboarding rilevante (pending_review, active, rejected).",
				tags: ["Admin"],
			},
		},
	)
	.get(
		"/sellers/:sellerId",
		async ({ params }) => {
			const data = await getSellerDetail(params.sellerId);
			return ok(data);
		},
		{
			params: t.Object({
				sellerId: t.String({ description: "ID del profilo venditore" }),
			}),
			response: withErrors({ 200: okRes(SellerProfileWithUserSchema) }),
			detail: {
				summary: "Dettaglio venditore",
				description:
					"Restituisce tutti i dati del venditore inclusi utente e organizzazione.",
				tags: ["Admin"],
			},
		},
	)
	.get(
		"/sellers",
		async ({ query }) => {
			const result = await listSellers(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: SellerListQuery,
			response: withErrors({ 200: okPageRes(SellerProfileWithUserSchema) }),
			detail: {
				summary: "Lista venditori",
				description:
					"Restituisce la lista paginata dei venditori. Filtrabile per stato di onboarding. Senza filtro, restituisce solo le candidature sottoposte a revisione (pending_review, active, rejected).",
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
