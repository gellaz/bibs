import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okPage } from "@/lib/responses";
import {
	okPageRes,
	okRes,
	SellerProfileChangeSchema,
	withErrors,
} from "@/lib/schemas";
import { SellerProfileChangeWithSellerSchema } from "@/lib/schemas/composed";
import { withAdmin } from "../context";
import {
	approveChange,
	listPendingChanges,
	rejectChange,
} from "../services/sellers";

export const sellerChangesRoutes = new Elysia()
	.get(
		"/sellers/changes/pending",
		async ({ query }) => {
			const result = await listPendingChanges(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: PaginationQuery,
			response: withErrors({
				200: okPageRes(SellerProfileChangeWithSellerSchema),
			}),
			detail: {
				summary: "Richieste di modifica in attesa",
				description:
					"Restituisce la lista paginata delle richieste di modifica profilo venditore in attesa di approvazione, ordinate per data di creazione.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/sellers/changes/:changeId/approve",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await approveChange(params.changeId, user.id);

			pino.info(
				{
					adminId: user.id,
					changeId: data.id,
					changeType: data.changeType,
					sellerProfileId: data.sellerProfileId,
					action: "change_approved",
				},
				"Seller change request approved",
			);

			return ok(data);
		},
		{
			params: t.Object({
				changeId: t.String({
					description: "ID della richiesta di modifica",
				}),
			}),
			response: withErrors({ 200: okRes(SellerProfileChangeSchema) }),
			detail: {
				summary: "Approva richiesta di modifica",
				description:
					"Approva una richiesta di modifica del profilo venditore e applica i nuovi dati. Per le modifiche P.IVA, sblocca anche la ricezione di nuovi ordini.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/sellers/changes/:changeId/reject",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await rejectChange({
				changeId: params.changeId,
				adminUserId: user.id,
				reason: (ctx as any).body?.reason,
			});

			pino.warn(
				{
					adminId: user.id,
					changeId: data.id,
					changeType: data.changeType,
					sellerProfileId: data.sellerProfileId,
					action: "change_rejected",
				},
				"Seller change request rejected",
			);

			return ok(data);
		},
		{
			params: t.Object({
				changeId: t.String({
					description: "ID della richiesta di modifica",
				}),
			}),
			body: t.Object({
				reason: t.Optional(
					t.String({
						maxLength: 500,
						description: "Motivo del rifiuto",
					}),
				),
			}),
			response: withErrors({ 200: okRes(SellerProfileChangeSchema) }),
			detail: {
				summary: "Rifiuta richiesta di modifica",
				description:
					"Rifiuta una richiesta di modifica del profilo venditore. Per le modifiche P.IVA, sblocca anche la ricezione di nuovi ordini (la P.IVA resta invariata).",
				tags: ["Admin"],
			},
		},
	);
