import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { ok, okPage } from "@/lib/responses";
import { SellerProfileWithUserSchema } from "@/lib/schemas/composed";
import { SellerProfileSchema } from "@/lib/schemas/entities";
import { RejectSellerBody } from "@/lib/schemas/forms/seller-rejection";
import { SellerListQuery } from "@/lib/schemas/queries";
import {
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas/responses";
import { zDate } from "@/lib/schemas/t";
import { adminDetail } from "../context";
import {
	countSellersByStatus,
	getSellerDetail,
	listSellers,
	rejectSeller,
	verifySeller,
} from "../services/sellers";

const CountsResponse = okRes(
	z.object({
		pending_review: z.number(),
		active: z.number(),
		rejected: z.number(),
	}),
);
const SellerDetailResponse = okRes(SellerProfileWithUserSchema);
const SellerPageResponse = okPageRes(SellerProfileWithUserSchema);
const SellerResponse = okRes(SellerProfileSchema);

const Params = z.object({
	sellerId: z.string().meta({ description: "ID del profilo venditore" }),
});

const ExpectedUpdatedAt = zDate({
	description:
		"`updatedAt` del venditore come l'admin l'ha visto: 409 se nel frattempo la candidatura è cambiata (es. reinvio dopo un rifiuto)",
});

export const VerifySellerBody = z.object({
	expectedUpdatedAt: ExpectedUpdatedAt,
});

export const RejectSellerRouteBody = RejectSellerBody.extend({
	expectedUpdatedAt: ExpectedUpdatedAt,
});

export const sellersRoutes = new Hono()
	.get(
		"/sellers/counts",
		doc({
			response: withErrors({ 200: CountsResponse }),
			detail: adminDetail(
				"Contatori venditori per stato",
				"Restituisce il numero di venditori per ogni stato di onboarding rilevante (pending_review, active, rejected).",
			),
		}),
		requireAdmin,
		async (c) => send(c, CountsResponse, ok(await countSellersByStatus())),
	)
	.get(
		"/sellers/:sellerId",
		doc({
			response: withErrors({ 200: SellerDetailResponse }),
			detail: adminDetail(
				"Dettaglio venditore",
				"Restituisce tutti i dati del venditore inclusi utente e organizzazione.",
			),
		}),
		v("param", Params),
		requireAdmin,
		async (c) => {
			const data = await getSellerDetail(c.req.valid("param").sellerId);
			return send(c, SellerDetailResponse, ok(data));
		},
	)
	.get(
		"/sellers",
		doc({
			response: withErrors({ 200: SellerPageResponse }),
			detail: adminDetail(
				"Lista venditori",
				"Restituisce la lista paginata dei venditori. Filtrabile per stato di onboarding. Senza filtro, restituisce solo le candidature sottoposte a revisione (pending_review, active, rejected).",
			),
		}),
		v("query", SellerListQuery),
		requireAdmin,
		async (c) => {
			const result = await listSellers(c.req.valid("query"));
			return send(
				c,
				SellerPageResponse,
				okPage(result.data, result.pagination),
			);
		},
	)
	.patch(
		"/sellers/:sellerId/verify",
		doc({
			response: withConflictErrors({ 200: SellerResponse }),
			detail: adminDetail(
				"Verifica venditore",
				"Approva il venditore e imposta l'onboarding come completato. Abilita il venditore a operare sulla piattaforma. Solo da pending_review e sulla versione vista dall'admin: 409 se la candidatura è già stata decisa o è cambiata.",
			),
		}),
		v("param", Params),
		v("json", VerifySellerBody),
		requireAdmin,
		async (c) => {
			const data = await verifySeller(
				c.req.valid("param").sellerId,
				c.req.valid("json").expectedUpdatedAt,
			);
			logger.info(
				{
					adminId: c.var.user.id,
					sellerId: data.id,
					userId: data.userId,
					action: "seller_verified",
				},
				"Venditore verificato",
			);
			return send(c, SellerResponse, ok(data));
		},
	)
	.patch(
		"/sellers/:sellerId/reject",
		doc({
			response: withConflictErrors({ 200: SellerResponse }),
			detail: adminDetail(
				"Rifiuta venditore",
				"Respinge la candidatura con un motivo obbligatorio, mostrato al venditore e inviato per email. `fixStep` null = rifiuto definitivo (rejected); `document` / `company` = il venditore torna a quello step per correggere e reinviare. Solo da pending_review e sulla versione vista dall'admin: 409 se la candidatura è già stata decisa o è cambiata.",
			),
		}),
		v("param", Params),
		v("json", RejectSellerRouteBody),
		requireAdmin,
		async (c) => {
			const { expectedUpdatedAt, ...rejection } = c.req.valid("json");
			const data = await rejectSeller(
				c.req.valid("param").sellerId,
				expectedUpdatedAt,
				rejection,
			);
			logger.warn(
				{
					adminId: c.var.user.id,
					sellerId: data.id,
					userId: data.userId,
					reason: rejection.reason,
					fixStep: rejection.fixStep,
					action: "seller_rejected",
				},
				"Venditore rifiutato",
			);
			return send(c, SellerResponse, ok(data));
		},
	);
