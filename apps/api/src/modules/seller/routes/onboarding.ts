import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import {
	okRes,
	SellerProfileSchema,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import {
	CompanyBody,
	DocumentBody,
	PersonalInfoBody,
} from "@/lib/schemas/forms";
import { withSellerAuth } from "../context";
import {
	getOnboardingStatus,
	goBack,
	updateCompany,
	updateDocument,
	updatePersonalInfo,
} from "../services/onboarding";

export const onboardingRoutes = new Elysia({ prefix: "/onboarding" })
	.get(
		"/status",
		async (ctx) => {
			const { user } = withSellerAuth(ctx);
			const data = await getOnboardingStatus(user.id);
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Stato onboarding",
				description:
					"Restituisce lo stato corrente dell'onboarding del venditore con tutti i dati già compilati.",
				tags: ["Seller - Onboarding"],
			},
		},
	)
	.patch(
		"/personal-info",
		async (ctx) => {
			const { user, body, store } = withSellerAuth(ctx);
			const pino = getLogger(store);
			const data = await updatePersonalInfo({ userId: user.id, ...body });

			pino.info(
				{ userId: user.id, action: "onboarding_personal_info" },
				"Seller personal info updated",
			);

			return ok(data);
		},
		{
			body: PersonalInfoBody,
			response: withErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Step 1: Dati anagrafici",
				description:
					"Aggiorna i dati anagrafici del venditore. Richiede onboardingStatus = 'pending_personal'.",
				tags: ["Seller - Onboarding"],
			},
		},
	)
	.patch(
		"/document",
		async (ctx) => {
			const { user, body, store } = withSellerAuth(ctx);
			const pino = getLogger(store);
			const data = await updateDocument({
				userId: user.id,
				documentNumber: body.documentNumber,
				documentExpiry: body.documentExpiry,
				documentIssuedMunicipalityId: body.documentIssuedMunicipalityId,
				documentImage: body.documentImage,
			});

			pino.info(
				{ userId: user.id, action: "onboarding_document" },
				"Seller document uploaded",
			);

			return ok(data);
		},
		{
			body: t.Object({
				...DocumentBody.properties,
				documentImage: t.File({
					type: "image",
					description: "Foto della carta d'identità",
				}),
			}),
			response: withErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Step 2: Documento identità",
				description:
					"Carica il documento d'identità del venditore. Richiede onboardingStatus = 'pending_document'.",
				tags: ["Seller - Onboarding"],
			},
		},
	)
	.patch(
		"/company",
		async (ctx) => {
			const { user, body, store } = withSellerAuth(ctx);
			const pino = getLogger(store);
			const data = await updateCompany({ userId: user.id, ...body });

			pino.info(
				{
					userId: user.id,
					vatNumber: body.vatNumber,
					action: "onboarding_company",
				},
				"Seller company info created",
			);

			return ok(data);
		},
		{
			body: CompanyBody,
			response: withConflictErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Step 3: Dati aziendali",
				description:
					"Inserisce le informazioni aziendali / societarie. Richiede onboardingStatus = 'pending_company'. Dopo questo step l'onboarding passa in revisione admin.",
				tags: ["Seller - Onboarding"],
			},
		},
	)
	.post(
		"/go-back",
		async (ctx) => {
			const { user, store } = withSellerAuth(ctx);
			const pino = getLogger(store);
			const data = await goBack(user.id);

			pino.info(
				{
					userId: user.id,
					newStatus: data.onboardingStatus,
					action: "onboarding_go_back",
				},
				"Seller went back in onboarding",
			);

			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Torna indietro",
				description:
					"Riporta l'onboarding allo step precedente. Eventuali dati inseriti nello step corrente vengono rimossi.",
				tags: ["Seller - Onboarding"],
			},
		},
	);
