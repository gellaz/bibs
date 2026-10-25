import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	CreateHolidayDefinitionBody,
	HolidayDefinitionSchema,
	HolidayPreviewSchema,
	UpdateHolidayDefinitionBody,
} from "@/lib/zod/holidays";
import {
	OkMessage,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/zod/responses";
import { zInteger } from "@/lib/zod/t";
import { adminDetail } from "../context";
import {
	createHolidayDefinition,
	deleteHolidayDefinition,
	listHolidayDefinitions,
	previewHolidayYear,
	updateHolidayDefinition,
} from "../services/holiday-definitions";

const HolidayListResponse = okRes(z.array(HolidayDefinitionSchema));
const HolidayPreviewResponse = okRes(z.array(HolidayPreviewSchema));
const HolidayResponse = okRes(HolidayDefinitionSchema);

const Params = z.object({
	holidayId: z.string().meta({ description: "ID della festività" }),
});

export const HolidayPreviewQuery = z.object({
	year: zInteger({
		minimum: 2000,
		maximum: 2100,
		description: "Anno da risolvere",
	}),
});

export const holidayDefinitionsRoutes = new Hono()
	.get(
		"/holiday-definitions",
		doc({
			response: withErrors({ 200: HolidayListResponse }),
			detail: adminDetail(
				"Lista festività",
				"Restituisce tutte le definizioni di festività (attive e disattivate).",
			),
		}),
		requireAdmin,
		async (c) =>
			send(c, HolidayListResponse, ok(await listHolidayDefinitions())),
	)
	.get(
		"/holiday-definitions/preview",
		doc({
			response: withErrors({ 200: HolidayPreviewResponse }),
			detail: adminDetail(
				"Anteprima festività per anno",
				"Risolve le festività attive a date concrete per l'anno indicato (verifica della Pasqua).",
			),
		}),
		v("query", HolidayPreviewQuery),
		requireAdmin,
		async (c) => {
			const data = await previewHolidayYear(c.req.valid("query").year);
			return send(c, HolidayPreviewResponse, ok(data));
		},
	)
	.post(
		"/holiday-definitions",
		doc({
			response: withConflictErrors({ 200: HolidayResponse }),
			detail: adminDetail(
				"Crea festività",
				"Crea una definizione di festività (fissa, relativa alla Pasqua, o data singola).",
			),
		}),
		v("json", CreateHolidayDefinitionBody),
		requireAdmin,
		async (c) => {
			const user = c.var.user;
			const data = await createHolidayDefinition(c.req.valid("json"), user.id);
			logger.info(
				{
					adminId: user.id,
					holidayId: data.id,
					holidayName: data.name,
					action: "holiday_definition_created",
				},
				"Festività creata",
			);
			return send(c, HolidayResponse, ok(data));
		},
	)
	.patch(
		"/holiday-definitions/:holidayId",
		doc({
			response: withConflictErrors({ 200: HolidayResponse }),
			detail: adminDetail(
				"Aggiorna festività",
				"Rinomina o attiva/disattiva una festività esistente.",
			),
		}),
		v("param", Params),
		v("json", UpdateHolidayDefinitionBody),
		requireAdmin,
		async (c) => {
			const data = await updateHolidayDefinition({
				id: c.req.valid("param").holidayId,
				...c.req.valid("json"),
			});
			logger.info(
				{
					adminId: c.var.user.id,
					holidayId: data.id,
					action: "holiday_definition_updated",
				},
				"Festività aggiornata",
			);
			return send(c, HolidayResponse, ok(data));
		},
	)
	.delete(
		"/holiday-definitions/:holidayId",
		doc({
			response: withConflictErrors({ 200: OkMessage }),
			detail: adminDetail(
				"Elimina festività",
				"Elimina una definizione di festività. Gli opt-out collegati dei negozi vengono rimossi automaticamente.",
			),
		}),
		v("param", Params),
		requireAdmin,
		async (c) => {
			const deleted = await deleteHolidayDefinition(
				c.req.valid("param").holidayId,
			);
			logger.info(
				{
					adminId: c.var.user.id,
					holidayId: deleted.id,
					holidayName: deleted.name,
					action: "holiday_definition_deleted",
				},
				"Festività eliminata",
			);
			return send(c, OkMessage, okMessage("Festività eliminata"));
		},
	);
