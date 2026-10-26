import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okPage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { SellerProfileChangeWithSellerSchema } from "@/lib/schemas/composed";
import { SellerProfileChangeSchema } from "@/lib/schemas/entities";
import { PaginationQuery } from "@/lib/schemas/pagination";
import {
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas/responses";
import { zString } from "@/lib/schemas/t";
import { adminDetail } from "../context";
import {
	approveChange,
	listPendingChanges,
	rejectChange,
} from "../services/sellers";

const PendingChangesResponse = okPageRes(SellerProfileChangeWithSellerSchema);
const ChangeResponse = okRes(SellerProfileChangeSchema);

const Params = z.object({
	changeId: z.string().meta({ description: "ID della richiesta di modifica" }),
});

export const RejectChangeBody = z.object({
	reason: zString({
		maxLength: 500,
		description: "Motivo del rifiuto",
	}).optional(),
});

export const sellerChangesRoutes = new Hono()
	.get(
		"/sellers/changes/pending",
		doc({
			response: withErrors({ 200: PendingChangesResponse }),
			detail: adminDetail(
				"Richieste di modifica in attesa",
				"Restituisce la lista paginata delle richieste di modifica profilo venditore in attesa di approvazione, ordinate per data di creazione.",
			),
		}),
		v("query", PaginationQuery),
		requireAdmin,
		async (c) => {
			const result = await listPendingChanges(c.req.valid("query"));
			return send(
				c,
				PendingChangesResponse,
				okPage(result.data, result.pagination),
			);
		},
	)
	.patch(
		"/sellers/changes/:changeId/approve",
		doc({
			response: withConflictErrors({ 200: ChangeResponse }),
			detail: adminDetail(
				"Approva richiesta di modifica",
				"Approva una richiesta di modifica del profilo venditore e applica i nuovi dati. Per le modifiche P.IVA, sblocca anche la ricezione di nuovi ordini.",
			),
		}),
		v("param", Params),
		requireAdmin,
		async (c) => {
			const adminId = c.var.user.id;
			const data = await approveChange(c.req.valid("param").changeId, adminId);
			logger.info(
				{
					adminId,
					changeId: data.id,
					changeType: data.changeType,
					sellerProfileId: data.sellerProfileId,
					action: "change_approved",
				},
				"Seller change request approved",
			);
			return send(c, ChangeResponse, ok(data));
		},
	)
	.patch(
		"/sellers/changes/:changeId/reject",
		doc({
			response: withErrors({ 200: ChangeResponse }),
			detail: adminDetail(
				"Rifiuta richiesta di modifica",
				"Rifiuta una richiesta di modifica del profilo venditore. Per le modifiche P.IVA, sblocca anche la ricezione di nuovi ordini (la P.IVA resta invariata).",
			),
		}),
		v("param", Params),
		v("json", RejectChangeBody),
		requireAdmin,
		async (c) => {
			const adminId = c.var.user.id;
			const data = await rejectChange({
				changeId: c.req.valid("param").changeId,
				adminUserId: adminId,
				reason: c.req.valid("json").reason,
			});
			logger.warn(
				{
					adminId,
					changeId: data.id,
					changeType: data.changeType,
					sellerProfileId: data.sellerProfileId,
					action: "change_rejected",
				},
				"Seller change request rejected",
			);
			return send(c, ChangeResponse, ok(data));
		},
	);
