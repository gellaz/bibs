import { Elysia, t } from "elysia";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	EmployeeInvitationSchema,
	EmployeeSchema,
	EmployeeWithUserSchema,
	OkMessage,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { TeamInviteBody } from "@/lib/schemas/forms";
import { requireOwner, withSeller } from "../context";
import {
	banEmployee,
	cancelInvitation,
	inviteEmployee,
	listEmployeeInvitations,
	listEmployees,
	removeEmployee,
	unbanEmployee,
} from "../services/employees";

const EmployeesListResponse = t.Object({
	success: t.Literal(true),
	data: t.Array(EmployeeWithUserSchema),
	pagination: t.Object({
		page: t.Number(),
		limit: t.Number(),
		total: t.Number(),
	}),
	owner: t.Nullable(
		t.Object({
			id: t.String(),
			name: t.String(),
			email: t.String(),
		}),
	),
});

export const employeesRoutes = new Elysia()
	.get(
		"/employees",
		async (ctx) => {
			const { sellerProfile: sp, query } = withSeller(ctx);
			const result = await listEmployees({ sellerProfileId: sp.id, ...query });
			return {
				...okPage(result.data, result.pagination),
				owner: result.owner,
			};
		},
		{
			query: PaginationQuery,
			response: withErrors({ 200: EmployeesListResponse }),
			detail: {
				summary: "Lista dipendenti",
				description:
					"Restituisce la lista paginata dei dipendenti del venditore con i dati utente e le informazioni del titolare.",
				tags: ["Seller - Employees"],
			},
		},
	)
	.post(
		"/employees/invite",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, body } = withSeller(ctx);
			requireOwner(isOwner);

			const data = await inviteEmployee(sp.id, body.email);
			return ok(data);
		},
		{
			body: TeamInviteBody,
			response: withConflictErrors({
				200: okRes(EmployeeInvitationSchema),
			}),
			detail: {
				summary: "Invita collaboratore",
				description:
					"Invia un invito email a un collaboratore. L'invitato riceverà un link per creare la password e accedere al pannello seller.",
				tags: ["Seller - Employees"],
			},
		},
	)
	.get(
		"/employees/invitations",
		async (ctx) => {
			const { sellerProfile: sp, isOwner } = withSeller(ctx);
			requireOwner(isOwner);

			const data = await listEmployeeInvitations(sp.id);
			return ok(data);
		},
		{
			response: withErrors({
				200: okRes(t.Array(EmployeeInvitationSchema)),
			}),
			detail: {
				summary: "Lista inviti",
				description:
					"Restituisce la lista degli inviti inviati ai collaboratori.",
				tags: ["Seller - Employees"],
			},
		},
	)
	.delete(
		"/employees/invitations/:invitationId",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params } = withSeller(ctx);
			requireOwner(isOwner);

			const data = await cancelInvitation(sp.id, params.invitationId);
			return ok(data);
		},
		{
			params: t.Object({
				invitationId: t.String({ description: "ID dell'invito" }),
			}),
			response: withErrors({ 200: okRes(EmployeeInvitationSchema) }),
			detail: {
				summary: "Annulla invito",
				description:
					"Annulla un invito in stato 'pending'. L'invito viene impostato come 'expired'.",
				tags: ["Seller - Employees"],
			},
		},
	)
	.patch(
		"/employees/:employeeId/ban",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params } = withSeller(ctx);
			requireOwner(isOwner);
			const data = await banEmployee({
				employeeId: params.employeeId,
				sellerProfileId: sp.id,
			});
			return ok(data);
		},
		{
			params: t.Object({
				employeeId: t.String({ description: "ID del dipendente" }),
			}),
			response: withErrors({ 200: okRes(EmployeeSchema) }),
			detail: {
				summary: "Banna dipendente",
				description:
					"Imposta lo stato del dipendente a 'banned'. Il dipendente non potrà più accedere.",
				tags: ["Seller - Employees"],
			},
		},
	)
	.patch(
		"/employees/:employeeId/unban",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params } = withSeller(ctx);
			requireOwner(isOwner);
			const data = await unbanEmployee({
				employeeId: params.employeeId,
				sellerProfileId: sp.id,
			});
			return ok(data);
		},
		{
			params: t.Object({
				employeeId: t.String({ description: "ID del dipendente" }),
			}),
			response: withErrors({ 200: okRes(EmployeeSchema) }),
			detail: {
				summary: "Riabilita dipendente",
				description: "Riporta lo stato del dipendente a 'active' dopo un ban.",
				tags: ["Seller - Employees"],
			},
		},
	)
	.delete(
		"/employees/:employeeId",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params } = withSeller(ctx);
			requireOwner(isOwner);
			await removeEmployee({
				employeeId: params.employeeId,
				sellerProfileId: sp.id,
			});
			return okMessage("Employee removed");
		},
		{
			params: t.Object({
				employeeId: t.String({ description: "ID del dipendente" }),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi dipendente",
				description:
					"Imposta lo stato del dipendente a 'removed'. L'operazione è un soft-delete.",
				tags: ["Seller - Employees"],
			},
		},
	);
