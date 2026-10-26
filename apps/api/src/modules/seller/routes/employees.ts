import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okMessage, okPage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { EmployeeWithUserSchema } from "@/schemas/composed";
import {
	EmployeeInvitationSchema,
	EmployeeSchema,
	MunicipalityCompactSchema,
} from "@/schemas/entities";
import { TeamInviteBody } from "@/schemas/forms/onboarding";
import { PaginationQuery } from "@/schemas/pagination";
import {
	OkMessage,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/schemas/responses";
import { requireOwner } from "../context";
import {
	banEmployee,
	cancelInvitation,
	getEmployeeStores,
	inviteEmployee,
	listEmployeeInvitations,
	listEmployees,
	removeEmployee,
	resendInvitation,
	setEmployeeStores,
	unbanEmployee,
} from "../services/employees";

const StoreMinimalSchema = z.object({
	id: z.string(),
	name: z.string(),
	municipalityId: z.string(),
	municipality: MunicipalityCompactSchema,
});

const EmployeesListResponse = z.object({
	success: z.literal(true),
	data: z.array(EmployeeWithUserSchema),
	pagination: z.object({
		page: z.number(),
		limit: z.number(),
		total: z.number(),
	}),
	owner: z
		.object({
			id: z.string(),
			name: z.string(),
			email: z.string(),
		})
		.nullable(),
});

const invitationId = z.object({
	invitationId: z.string().meta({ description: "ID dell'invito" }),
});
const employeeId = z.object({
	employeeId: z.string().meta({ description: "ID del dipendente" }),
});

const InvitationRes = okRes(EmployeeInvitationSchema);
const InvitationsRes = okRes(z.array(EmployeeInvitationSchema));
const EmployeeRes = okRes(EmployeeSchema);
const StoresRes = okRes(z.array(StoreMinimalSchema));

const detail = (summary: string, description: string) => ({
	summary,
	description,
	tags: ["Seller - Employees"],
	security: [{ bearerAuth: [] }],
});

export const employeesRoutes = new Hono()
	.get(
		"/employees",
		doc({
			response: withErrors({ 200: EmployeesListResponse }),
			detail: detail(
				"Lista dipendenti",
				"Restituisce la lista paginata dei dipendenti del venditore con i dati utente e le informazioni del titolare.",
			),
		}),
		v("query", PaginationQuery),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp } = c.var.seller;
			const result = await listEmployees({
				sellerProfileId: sp.id,
				...c.req.valid("query"),
			});
			return send(c, EmployeesListResponse, {
				...okPage(result.data, result.pagination),
				owner: result.owner,
			});
		},
	)
	.post(
		"/employees/invite",
		doc({
			response: withConflictErrors({ 200: InvitationRes }),
			detail: detail(
				"Invita collaboratore",
				"Invia un invito email a un collaboratore. L'invitato riceverà un link per creare la password e accedere al pannello seller.",
			),
		}),
		v("json", TeamInviteBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);

			const body = c.req.valid("json");
			const data = await inviteEmployee(sp.id, body.email, body.storeIds);
			return send(c, InvitationRes, ok(data));
		},
	)
	.get(
		"/employees/invitations",
		doc({
			response: withErrors({ 200: InvitationsRes }),
			detail: detail(
				"Lista inviti",
				"Restituisce la lista degli inviti inviati ai collaboratori.",
			),
		}),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);

			const data = await listEmployeeInvitations(sp.id);
			return send(c, InvitationsRes, ok(data));
		},
	)
	.delete(
		"/employees/invitations/:invitationId",
		doc({
			response: withErrors({ 200: InvitationRes }),
			detail: detail(
				"Annulla invito",
				"Annulla un invito in stato 'pending'. L'invito viene impostato come 'expired'.",
			),
		}),
		v("param", invitationId),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);

			const data = await cancelInvitation(
				sp.id,
				c.req.valid("param").invitationId,
			);
			return send(c, InvitationRes, ok(data));
		},
	)
	.post(
		"/employees/invitations/:invitationId/resend",
		doc({
			response: withErrors({ 200: InvitationRes }),
			detail: detail(
				"Reinvia invito",
				"Reinvia l'email di un invito in stato 'pending' (stesso link) e ne sposta la scadenza a 7 giorni da adesso, anche se era già scaduto. 404 se l'invito non è pending, 502 se l'email non parte.",
			),
		}),
		v("param", invitationId),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);

			const data = await resendInvitation(
				sp.id,
				c.req.valid("param").invitationId,
			);
			return send(c, InvitationRes, ok(data));
		},
	)
	.patch(
		"/employees/:employeeId/ban",
		doc({
			response: withErrors({ 200: EmployeeRes }),
			detail: detail(
				"Banna dipendente",
				"Imposta lo stato del dipendente a 'banned'. Il dipendente non potrà più accedere.",
			),
		}),
		v("param", employeeId),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await banEmployee({
				employeeId: c.req.valid("param").employeeId,
				sellerProfileId: sp.id,
			});
			return send(c, EmployeeRes, ok(data));
		},
	)
	.patch(
		"/employees/:employeeId/unban",
		doc({
			response: withErrors({ 200: EmployeeRes }),
			detail: detail(
				"Riabilita dipendente",
				"Riporta lo stato del dipendente a 'active' dopo un ban.",
			),
		}),
		v("param", employeeId),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await unbanEmployee({
				employeeId: c.req.valid("param").employeeId,
				sellerProfileId: sp.id,
			});
			return send(c, EmployeeRes, ok(data));
		},
	)
	.delete(
		"/employees/:employeeId",
		doc({
			response: withErrors({ 200: OkMessage }),
			detail: detail(
				"Rimuovi dipendente",
				"Imposta lo stato del dipendente a 'removed'. L'operazione è un soft-delete.",
			),
		}),
		v("param", employeeId),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			await removeEmployee({
				employeeId: c.req.valid("param").employeeId,
				sellerProfileId: sp.id,
			});
			return send(c, OkMessage, okMessage("Dipendente rimosso"));
		},
	)
	.get(
		"/employees/:employeeId/stores",
		doc({
			response: withErrors({ 200: StoresRes }),
			detail: detail(
				"Negozi assegnati al dipendente",
				"Restituisce la lista dei negozi a cui il dipendente è assegnato. Solo titolare.",
			),
		}),
		v("param", employeeId),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await getEmployeeStores({
				sellerProfileId: sp.id,
				employeeId: c.req.valid("param").employeeId,
			});
			return send(c, StoresRes, ok(data));
		},
	)
	.put(
		"/employees/:employeeId/stores",
		doc({
			response: withErrors({ 200: StoresRes }),
			detail: detail(
				"Aggiorna assegnazione negozi",
				"Sostituisce l'insieme di negozi assegnati al dipendente (idempotente). Solo titolare.",
			),
		}),
		v("param", employeeId),
		v(
			"json",
			z.object({
				storeIds: z
					.array(z.string())
					.meta({ description: "ID dei negozi (replace idempotente)" }),
			}),
		),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await setEmployeeStores({
				sellerProfileId: sp.id,
				employeeId: c.req.valid("param").employeeId,
				storeIds: c.req.valid("json").storeIds,
			});
			return send(c, StoresRes, ok(data));
		},
	);
