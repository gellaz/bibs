import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okPage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import {
	AdminChangeDetailSchema,
	AdminRequestRowSchema,
} from "@/schemas/composed";
import { PaginationQuery } from "@/schemas/pagination";
import { okPageRes, okRes, withErrors } from "@/schemas/responses";
import { adminDetail } from "../context";
import {
	countRequests,
	getChangeDetail,
	listRequests,
} from "../services/requests";

const RequestPageResponse = okPageRes(AdminRequestRowSchema);
const RequestCountsResponse = okRes(
	z.object({
		total: z.number(),
		candidature: z.number(),
		vat: z.number(),
		document: z.number(),
	}),
);
const ChangeDetailResponse = okRes(AdminChangeDetailSchema);

export const RequestListQuery = PaginationQuery.extend({
	type: z
		.enum(["all", "candidature", "vat", "document"])
		.default("all")
		.meta({ description: "Filtra per tipo di richiesta" })
		.optional(),
});

const Params = z.object({
	changeId: z.string().meta({ description: "ID della richiesta di modifica" }),
});

export const requestsRoutes = new Hono()
	.get(
		// Prima di Hono era `/requests/` (prefisso + "/"), chiamato senza slash (D8).
		"/requests",
		doc({
			path: "/requests/",
			response: withErrors({ 200: RequestPageResponse }),
			detail: adminDetail(
				"Richieste in attesa",
				"Candidature venditore in revisione e richieste di modifica (P.IVA, documento) in attesa, dalla più vecchia.",
			),
		}),
		v("query", RequestListQuery),
		requireAdmin,
		async (c) => {
			const result = await listRequests(c.req.valid("query"));
			return send(
				c,
				RequestPageResponse,
				okPage(result.data, result.pagination),
			);
		},
	)
	.get(
		"/requests/counts",
		doc({
			response: withErrors({ 200: RequestCountsResponse }),
			detail: adminDetail(
				"Conteggi richieste in attesa",
				"Totale e per tipo, per il badge della sidebar.",
			),
		}),
		requireAdmin,
		async (c) => send(c, RequestCountsResponse, ok(await countRequests())),
	)
	.get(
		"/requests/changes/:changeId",
		doc({
			response: withErrors({ 200: ChangeDetailResponse }),
			detail: adminDetail(
				"Dettaglio richiesta di modifica",
				"Valori attuali e richiesti di una richiesta di modifica, anche se non più in attesa.",
			),
		}),
		v("param", Params),
		requireAdmin,
		async (c) => {
			const data = await getChangeDetail(c.req.valid("param").changeId);
			return send(c, ChangeDetailResponse, ok(data));
		},
	);
