import { Hono } from "hono";
import { z } from "zod";
import { requireSellerRole } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import { SellerProfileSchema } from "@/lib/schemas/entities";
import { okRes, withConflictErrors, withErrors } from "@/lib/schemas/responses";
import { zFile } from "@/lib/schemas/t";
import {
	CompanyBody,
	DocumentBody,
	PersonalInfoBody,
} from "@/lib/zod/forms/onboarding";
import {
	getOnboardingStatus,
	goBack,
	updateCompany,
	updateDocument,
	updatePersonalInfo,
} from "../services/onboarding";

const StatusRes = okRes(
	SellerProfileSchema.extend({
		supportEmail: z.string().meta({
			description: "Indirizzo del supporto da mostrare al venditore",
		}),
	}),
);
const ProfileRes = okRes(SellerProfileSchema);

const detail = (summary: string, description: string) => ({
	summary,
	description,
	tags: ["Seller - Onboarding"],
	security: [{ bearerAuth: [] }],
});

export const onboardingRoutes = new Hono()
	.get(
		"/onboarding/status",
		doc({
			response: withErrors({ 200: StatusRes }),
			detail: detail(
				"Stato onboarding",
				"Restituisce lo stato corrente dell'onboarding del venditore con tutti i dati già compilati e l'indirizzo del supporto.",
			),
		}),
		requireSellerRole,
		async (c) =>
			send(c, StatusRes, ok(await getOnboardingStatus(c.var.user.id))),
	)
	.patch(
		"/onboarding/personal-info",
		doc({
			response: withErrors({ 200: ProfileRes }),
			detail: detail(
				"Step 1: Dati anagrafici",
				"Aggiorna i dati anagrafici del venditore. Richiede onboardingStatus = 'pending_personal'.",
			),
		}),
		v("json", PersonalInfoBody),
		requireSellerRole,
		async (c) => {
			const user = c.var.user;
			const data = await updatePersonalInfo({
				userId: user.id,
				...c.req.valid("json"),
			});

			logger.info(
				{ userId: user.id, action: "onboarding_personal_info" },
				"Seller personal info updated",
			);

			return send(c, ProfileRes, ok(data));
		},
	)
	.patch(
		"/onboarding/document",
		doc({
			response: withErrors({ 200: ProfileRes }),
			detail: detail(
				"Step 2: Documento identità",
				"Carica il documento d'identità del venditore. Richiede onboardingStatus = 'pending_document'.",
			),
		}),
		v(
			"form",
			DocumentBody.extend({
				documentImage: zFile({
					type: "image",
					description: "Foto del documento d'identità",
				}),
			}),
		),
		requireSellerRole,
		async (c) => {
			const user = c.var.user;
			const body = c.req.valid("form");
			const data = await updateDocument({
				userId: user.id,
				documentType: body.documentType,
				documentNumber: body.documentNumber,
				documentExpiry: body.documentExpiry,
				documentIssuedMunicipalityId: body.documentIssuedMunicipalityId,
				documentImage: body.documentImage,
			});

			logger.info(
				{ userId: user.id, action: "onboarding_document" },
				"Seller document uploaded",
			);

			return send(c, ProfileRes, ok(data));
		},
	)
	.patch(
		"/onboarding/company",
		doc({
			response: withConflictErrors({ 200: ProfileRes }),
			detail: detail(
				"Step 3: Dati aziendali",
				"Inserisce le informazioni aziendali / societarie. Richiede onboardingStatus = 'pending_company'. Dopo questo step l'onboarding passa in revisione admin.",
			),
		}),
		v("json", CompanyBody),
		requireSellerRole,
		async (c) => {
			const user = c.var.user;
			const body = c.req.valid("json");
			const data = await updateCompany({ userId: user.id, ...body });

			logger.info(
				{
					userId: user.id,
					vatNumber: body.vatNumber,
					action: "onboarding_company",
				},
				"Seller company info created",
			);

			return send(c, ProfileRes, ok(data));
		},
	)
	.post(
		"/onboarding/go-back",
		doc({
			response: withErrors({ 200: ProfileRes }),
			detail: detail(
				"Torna indietro",
				"Riporta l'onboarding allo step precedente. Eventuali dati inseriti nello step corrente vengono rimossi.",
			),
		}),
		requireSellerRole,
		async (c) => {
			const user = c.var.user;
			const data = await goBack(user.id);

			logger.info(
				{
					userId: user.id,
					newStatus: data.onboardingStatus,
					action: "onboarding_go_back",
				},
				"Seller went back in onboarding",
			);

			return send(c, ProfileRes, ok(data));
		},
	);
