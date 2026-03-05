import { Elysia, t } from "elysia";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	EmployeeSchema,
	EmployeeWithUserSchema,
	OkMessage,
	okPageRes,
	okRes,
	withErrors,
} from "@/lib/schemas";
import { requireOwner, withSeller } from "../context";
import {
	banEmployee,
	createEmployee,
	listEmployees,
	removeEmployee,
	unbanEmployee,
} from "../services/employees";

export const employeesRoutes = new Elysia()
	.get(
		"/employees",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, query } = withSeller(ctx);
			requireOwner(isOwner);
			const result = await listEmployees({ sellerProfileId: sp.id, ...query });
			return okPage(result.data, result.pagination);
		},
		{
			query: PaginationQuery,
			response: withErrors({ 200: okPageRes(EmployeeWithUserSchema) }),
			detail: {
				summary: "Lista dipendenti",
				description:
					"Restituisce la lista paginata dei dipendenti del venditore con i dati utente. Solo il proprietario può accedere.",
				tags: ["Seller - Employees"],
			},
		},
	)
	.post(
		"/employees",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, body } = withSeller(ctx);
			requireOwner(isOwner);

			const data = await createEmployee({ sellerProfileId: sp.id, ...body });
			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 100, description: "Nome completo del dipendente" }),
				email: t.String({
					format: "email",
					description: "Email del dipendente",
				}),
				password: t.String({
					minLength: 8,
					maxLength: 128,
					description: "Password (minimo 8, massimo 128 caratteri)",
				}),
			}),
			response: withErrors({ 200: okRes(EmployeeSchema) }),
			detail: {
				summary: "Crea dipendente",
				description:
					"Crea un nuovo account dipendente associato al venditore. Il dipendente potrà accedere alle funzioni del pannello seller.",
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
