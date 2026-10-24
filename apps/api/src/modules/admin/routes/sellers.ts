import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { SellerListQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	okPageRes,
	okRes,
	SellerProfileSchema,
	SellerProfileWithUserSchema,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { RejectSellerBody } from "@/lib/schemas/forms";
import { withAdmin } from "../context";
import {
	countSellersByStatus,
	getSellerDetail,
	listSellers,
	rejectSeller,
	verifySeller,
} from "../services/sellers";

const ExpectedUpdatedAt = t.Date({
	description:
		"`updatedAt` del venditore come l'admin l'ha visto: 409 se nel frattempo la candidatura è cambiata (es. reinvio dopo un rifiuto)",
});

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
			const { params, body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await verifySeller(params.sellerId, body.expectedUpdatedAt);

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
			body: t.Object({ expectedUpdatedAt: ExpectedUpdatedAt }),
			response: withConflictErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Verifica venditore",
				description:
					"Approva il venditore e imposta l'onboarding come completato. Abilita il venditore a operare sulla piattaforma. Solo da pending_review e sulla versione vista dall'admin: 409 se la candidatura è già stata decisa o è cambiata.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/sellers/:sellerId/reject",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const { expectedUpdatedAt, ...rejection } = body;
			const data = await rejectSeller(
				params.sellerId,
				expectedUpdatedAt,
				rejection,
			);

			pino.warn(
				{
					adminId: user.id,
					sellerId: data.id,
					userId: data.userId,
					reason: body.reason,
					fixStep: body.fixStep,
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
			body: t.Object({
				...RejectSellerBody.properties,
				expectedUpdatedAt: ExpectedUpdatedAt,
			}),
			response: withConflictErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Rifiuta venditore",
				description:
					"Respinge la candidatura con un motivo obbligatorio, mostrato al venditore e inviato per email. `fixStep` null = rifiuto definitivo (rejected); `document` / `company` = il venditore torna a quello step per correggere e reinviare. Solo da pending_review e sulla versione vista dall'admin: 409 se la candidatura è già stata decisa o è cambiata.",
				tags: ["Admin"],
			},
		},
	);
