import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import {
	OnlinePaymentsSchema,
	OrganizationSchema,
	okRes,
	SellerProfileChangeSchema,
	SellerProfileSchema,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { SellerSettingsSchema } from "@/lib/schemas/composed";
import {
	CompanySettingsBody,
	DocumentChangeBody,
	PersonalSettingsBody,
	VatChangeBody,
} from "@/lib/schemas/forms";
import {
	createOnboardingLink,
	syncOnlinePayments,
} from "@/modules/billing/services/connect-account";
import { requireOwner, withSeller } from "../context";
import {
	getSellerSettings,
	requestDocumentChange,
	requestVatChange,
	updateCompanySettings,
	updatePersonalSettings,
} from "../services/settings";

export const settingsRoutes = new Elysia({ prefix: "/settings" })
	.get(
		"/",
		async (ctx) => {
			const { sellerProfile, store, isOwner, user } = withSeller(ctx);
			const pino = getLogger(store);
			const data = await getSellerSettings({
				sellerProfileId: sellerProfile.id,
				userId: user.id,
				isOwner,
			});

			pino.info(
				{ sellerId: sellerProfile.id, action: "get_seller_settings" },
				"Seller settings retrieved",
			);

			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(SellerSettingsSchema) }),
			detail: {
				summary: "Impostazioni venditore",
				description:
					"Restituisce il profilo completo del venditore con organizzazione, stato dei pagamenti online e richieste di modifica in attesa.",
				tags: ["Seller - Settings"],
			},
		},
	)
	.patch(
		"/personal",
		async (ctx) => {
			const { sellerProfile: sp, user, store, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const pino = getLogger(store);
			const data = await updatePersonalSettings({
				sellerProfileId: sp.id,
				userId: user.id,
				...ctx.body,
			});

			pino.info(
				{ sellerId: sp.id, action: "update_personal_settings" },
				"Seller personal settings updated",
			);

			return ok(data);
		},
		{
			body: PersonalSettingsBody,
			response: withErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Aggiorna dati anagrafici",
				description:
					"Aggiorna i dati anagrafici del venditore (modifica libera, nessuna approvazione richiesta). Solo il titolare può modificare.",
				tags: ["Seller - Settings"],
			},
		},
	)
	.patch(
		"/company",
		async (ctx) => {
			const { sellerProfile: sp, store, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const pino = getLogger(store);
			const data = await updateCompanySettings({
				sellerProfileId: sp.id,
				...ctx.body,
			});

			pino.info(
				{ sellerId: sp.id, action: "update_company_settings" },
				"Seller company settings updated",
			);

			return ok(data);
		},
		{
			body: CompanySettingsBody,
			response: withErrors({ 200: okRes(OrganizationSchema) }),
			detail: {
				summary: "Aggiorna dati aziendali",
				description:
					"Aggiorna i dati aziendali (ragione sociale, forma giuridica, indirizzo sede). La partita IVA non è modificabile da qui. Solo il titolare può modificare.",
				tags: ["Seller - Settings"],
			},
		},
	)
	.patch(
		"/vat",
		async (ctx) => {
			const { sellerProfile: sp, store, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const pino = getLogger(store);
			const data = await requestVatChange({
				sellerProfileId: sp.id,
				...ctx.body,
			});

			pino.info(
				{
					sellerId: sp.id,
					newVatNumber: ctx.body.vatNumber,
					action: "request_vat_change",
				},
				"Seller VAT change requested",
			);

			return ok(data);
		},
		{
			body: VatChangeBody,
			response: withConflictErrors({
				200: okRes(SellerProfileChangeSchema),
			}),
			detail: {
				summary: "Richiedi cambio partita IVA",
				description:
					"Crea una richiesta di modifica della partita IVA. Richiede approvazione admin. Durante la review il seller non può ricevere nuovi ordini. Solo il titolare può richiedere.",
				tags: ["Seller - Settings"],
			},
		},
	)
	.patch(
		"/document",
		async (ctx) => {
			const { sellerProfile: sp, store, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const pino = getLogger(store);
			const data = await requestDocumentChange({
				sellerProfileId: sp.id,
				documentNumber: ctx.body.documentNumber,
				documentExpiry: ctx.body.documentExpiry,
				documentIssuedMunicipalityId: ctx.body.documentIssuedMunicipalityId,
				documentImage: (ctx as any).body?.documentImage,
			});

			pino.info(
				{ sellerId: sp.id, action: "request_document_change" },
				"Seller document change requested",
			);

			return ok(data);
		},
		{
			body: t.Object({
				...DocumentChangeBody.properties,
				documentImage: t.Optional(
					t.File({
						type: "image",
						description: "Nuova foto della carta d'identità",
					}),
				),
			}),
			response: withConflictErrors({
				200: okRes(SellerProfileChangeSchema),
			}),
			detail: {
				summary: "Richiedi aggiornamento documento",
				description:
					"Crea una richiesta di aggiornamento del documento di identità. Richiede approvazione admin. L'operatività del negozio non viene interrotta. Solo il titolare può richiedere.",
				tags: ["Seller - Settings"],
			},
		},
	)
	.post(
		"/payments/onboarding",
		async (ctx) => {
			const { sellerProfile: sp, store, isOwner, user } = withSeller(ctx);
			requireOwner(isOwner);
			const data = await createOnboardingLink({
				sellerProfileId: sp.id,
				email: user.email,
			});
			getLogger(store).info(
				{ sellerId: sp.id, action: "connect_onboarding_link" },
				"Connect onboarding link created",
			);
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(t.Object({ url: t.String() })) }),
			detail: {
				summary: "Link di attivazione pagamenti online",
				description:
					"Crea il conto Stripe Connect del venditore se manca e restituisce il link all'onboarding ospitato da Stripe. Il link scade in pochi minuti. Solo il titolare.",
				tags: ["Seller - Settings"],
			},
		},
	)
	.post(
		"/payments/sync",
		async (ctx) => {
			const { sellerProfile: sp, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			return ok(await syncOnlinePayments(sp.id));
		},
		{
			response: withErrors({ 200: okRes(OnlinePaymentsSchema) }),
			detail: {
				summary: "Aggiorna stato pagamenti online",
				description:
					"Rilegge il conto Stripe Connect e aggiorna lo stato salvato. Da chiamare al ritorno dall'onboarding. Solo il titolare.",
				tags: ["Seller - Settings"],
			},
		},
	);
