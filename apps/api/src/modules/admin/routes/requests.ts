import { Elysia, t } from "elysia";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okPage } from "@/lib/responses";
import { okPageRes, okRes, withErrors } from "@/lib/schemas";
import {
	AdminChangeDetailSchema,
	AdminRequestRowSchema,
} from "@/lib/schemas/composed";
import {
	countRequests,
	getChangeDetail,
	listRequests,
} from "../services/requests";

export const requestsRoutes = new Elysia({ prefix: "/requests" })
	.get(
		"/",
		async ({ query }) => {
			const result = await listRequests(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: t.Composite([
				PaginationQuery,
				t.Object({
					type: t.Optional(
						t.Union(
							[
								t.Literal("all"),
								t.Literal("candidature"),
								t.Literal("vat"),
								t.Literal("document"),
							],
							{ default: "all", description: "Filtra per tipo di richiesta" },
						),
					),
				}),
			]),
			response: withErrors({ 200: okPageRes(AdminRequestRowSchema) }),
			detail: {
				summary: "Richieste in attesa",
				description:
					"Candidature venditore in revisione e richieste di modifica (P.IVA, documento) in attesa, dalla più vecchia.",
				tags: ["Admin"],
			},
		},
	)
	.get("/counts", async () => ok(await countRequests()), {
		response: withErrors({
			200: okRes(
				t.Object({
					total: t.Number(),
					candidature: t.Number(),
					vat: t.Number(),
					document: t.Number(),
				}),
			),
		}),
		detail: {
			summary: "Conteggi richieste in attesa",
			description: "Totale e per tipo, per il badge della sidebar.",
			tags: ["Admin"],
		},
	})
	.get(
		"/changes/:changeId",
		async ({ params }) => ok(await getChangeDetail(params.changeId)),
		{
			params: t.Object({
				changeId: t.String({ description: "ID della richiesta di modifica" }),
			}),
			response: withErrors({ 200: okRes(AdminChangeDetailSchema) }),
			detail: {
				summary: "Dettaglio richiesta di modifica",
				description:
					"Valori attuali e richiesti di una richiesta di modifica, anche se non più in attesa.",
				tags: ["Admin"],
			},
		},
	);
