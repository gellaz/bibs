import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	CreateHolidayDefinitionBody,
	HolidayDefinitionSchema,
	HolidayPreviewSchema,
	OkMessage,
	okRes,
	UpdateHolidayDefinitionBody,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	createHolidayDefinition,
	deleteHolidayDefinition,
	listHolidayDefinitions,
	previewHolidayYear,
	updateHolidayDefinition,
} from "../services/holiday-definitions";

export const holidayDefinitionsRoutes = new Elysia()
	.get(
		"/holiday-definitions",
		async () => {
			const data = await listHolidayDefinitions();
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(t.Array(HolidayDefinitionSchema)) }),
			detail: {
				summary: "Lista festività",
				description:
					"Restituisce tutte le definizioni di festività (attive e disattivate).",
				tags: ["Admin"],
			},
		},
	)
	.get(
		"/holiday-definitions/preview",
		async (ctx) => {
			const { query } = withAdmin(ctx);
			const data = await previewHolidayYear(query.year);
			return ok(data);
		},
		{
			query: t.Object({
				year: t.Integer({
					minimum: 2000,
					maximum: 2100,
					description: "Anno da risolvere",
				}),
			}),
			response: withErrors({ 200: okRes(t.Array(HolidayPreviewSchema)) }),
			detail: {
				summary: "Anteprima festività per anno",
				description:
					"Risolve le festività attive a date concrete per l'anno indicato (verifica della Pasqua).",
				tags: ["Admin"],
			},
		},
	)
	.post(
		"/holiday-definitions",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await createHolidayDefinition(body, user.id);
			pino.info(
				{
					adminId: user.id,
					holidayId: data.id,
					holidayName: data.name,
					action: "holiday_definition_created",
				},
				"Festività creata",
			);
			return ok(data);
		},
		{
			body: CreateHolidayDefinitionBody,
			response: withConflictErrors({ 200: okRes(HolidayDefinitionSchema) }),
			detail: {
				summary: "Crea festività",
				description:
					"Crea una definizione di festività (fissa, relativa alla Pasqua, o data singola).",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/holiday-definitions/:holidayId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const data = await updateHolidayDefinition({
				id: params.holidayId,
				...body,
			});
			pino.info(
				{
					adminId: user.id,
					holidayId: data.id,
					action: "holiday_definition_updated",
				},
				"Festività aggiornata",
			);
			return ok(data);
		},
		{
			params: t.Object({
				holidayId: t.String({ description: "ID della festività" }),
			}),
			body: UpdateHolidayDefinitionBody,
			response: withConflictErrors({ 200: okRes(HolidayDefinitionSchema) }),
			detail: {
				summary: "Aggiorna festività",
				description: "Rinomina o attiva/disattiva una festività esistente.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/holiday-definitions/:holidayId",
		async (ctx) => {
			const { params, store, user } = withAdmin(ctx);
			const pino = getLogger(store);
			const deleted = await deleteHolidayDefinition(params.holidayId);
			pino.info(
				{
					adminId: user.id,
					holidayId: deleted.id,
					holidayName: deleted.name,
					action: "holiday_definition_deleted",
				},
				"Festività eliminata",
			);
			return okMessage("Holiday definition deleted");
		},
		{
			params: t.Object({
				holidayId: t.String({ description: "ID della festività" }),
			}),
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina festività",
				description:
					"Elimina una definizione di festività. Gli opt-out collegati dei negozi vengono rimossi automaticamente.",
				tags: ["Admin"],
			},
		},
	);
