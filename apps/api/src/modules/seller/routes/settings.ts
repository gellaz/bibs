import { Hono } from "hono";
import { z } from "zod";
import {
	createOnboardingLink,
	syncOnlinePayments,
} from "@/domain/billing/connect-account";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { SellerSettingsSchema } from "@/lib/schemas/composed";
import {
	OnlinePaymentsSchema,
	OrganizationSchema,
	SellerProfileChangeSchema,
	SellerProfileSchema,
} from "@/lib/schemas/entities";
import {
	CompanySettingsBody,
	DocumentChangeBody,
	PersonalSettingsBody,
	VatChangeBody,
} from "@/lib/schemas/forms/settings";
import { okRes, withConflictErrors, withErrors } from "@/lib/schemas/responses";
import { zFile } from "@/lib/schemas/t";
import { requireOwner } from "../context";
import {
	cancelSellerChange,
	getSellerSettings,
	requestDocumentChange,
	requestVatChange,
	updateCompanySettings,
	updatePersonalSettings,
} from "../services/settings";

const SettingsRes = okRes(SellerSettingsSchema);
const ProfileRes = okRes(SellerProfileSchema);
const OrganizationRes = okRes(OrganizationSchema);
const ChangeRes = okRes(SellerProfileChangeSchema);
const LinkRes = okRes(z.object({ url: z.string() }));
const PaymentsRes = okRes(OnlinePaymentsSchema);

const detail = (summary: string, description: string) => ({
	summary,
	description,
	tags: ["Seller - Settings"],
	security: [{ bearerAuth: [] }],
});

export const settingsRoutes = new Hono()
	.get(
		"/settings",
		doc({
			// Prima di Hono era `/settings/` (prefisso + "/"): /openapi resta quello.
			path: "/settings/",
			response: withErrors({ 200: SettingsRes }),
			detail: detail(
				"Impostazioni venditore",
				"Restituisce il profilo completo del venditore con organizzazione, stato dei pagamenti online e richieste di modifica in attesa.",
			),
		}),
		requireSeller,
		async (c) => {
			const { sellerProfile, isOwner } = c.var.seller;
			const data = await getSellerSettings({
				sellerProfileId: sellerProfile.id,
				userId: c.var.user.id,
				isOwner,
			});

			logger.info(
				{ sellerId: sellerProfile.id, action: "get_seller_settings" },
				"Seller settings retrieved",
			);

			return send(c, SettingsRes, ok(data));
		},
	)
	.patch(
		"/settings/personal",
		doc({
			response: withErrors({ 200: ProfileRes }),
			detail: detail(
				"Aggiorna dati anagrafici",
				"Aggiorna i dati anagrafici del venditore (modifica libera, nessuna approvazione richiesta). Solo il titolare può modificare.",
			),
		}),
		v("json", PersonalSettingsBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await updatePersonalSettings({
				sellerProfileId: sp.id,
				userId: c.var.user.id,
				...c.req.valid("json"),
			});

			logger.info(
				{ sellerId: sp.id, action: "update_personal_settings" },
				"Seller personal settings updated",
			);

			return send(c, ProfileRes, ok(data));
		},
	)
	.patch(
		"/settings/company",
		doc({
			response: withErrors({ 200: OrganizationRes }),
			detail: detail(
				"Aggiorna dati aziendali",
				"Aggiorna i dati aziendali (ragione sociale, forma giuridica, indirizzo sede). La partita IVA non è modificabile da qui. Solo il titolare può modificare.",
			),
		}),
		v("json", CompanySettingsBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await updateCompanySettings({
				sellerProfileId: sp.id,
				...c.req.valid("json"),
			});

			logger.info(
				{ sellerId: sp.id, action: "update_company_settings" },
				"Seller company settings updated",
			);

			return send(c, OrganizationRes, ok(data));
		},
	)
	.patch(
		"/settings/vat",
		doc({
			response: withConflictErrors({ 200: ChangeRes }),
			detail: detail(
				"Richiedi cambio partita IVA",
				"Crea una richiesta di modifica della partita IVA. Richiede approvazione admin. Durante la review il seller non può ricevere nuovi ordini. Solo il titolare può richiedere.",
			),
		}),
		v("json", VatChangeBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const body = c.req.valid("json");
			const data = await requestVatChange({ sellerProfileId: sp.id, ...body });

			logger.info(
				{
					sellerId: sp.id,
					newVatNumber: body.vatNumber,
					action: "request_vat_change",
				},
				"Seller VAT change requested",
			);

			return send(c, ChangeRes, ok(data));
		},
	)
	.patch(
		"/settings/document",
		doc({
			response: withConflictErrors({ 200: ChangeRes }),
			detail: detail(
				"Richiedi aggiornamento documento",
				"Crea una richiesta di aggiornamento del documento di identità. Richiede approvazione admin. L'operatività del negozio non viene interrotta. Solo il titolare può richiedere.",
			),
		}),
		v(
			"form",
			DocumentChangeBody.extend({
				documentImage: zFile({
					type: "image",
					description: "Nuova foto del documento d'identità",
				}).optional(),
			}),
		),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const body = c.req.valid("form");
			const data = await requestDocumentChange({
				sellerProfileId: sp.id,
				documentType: body.documentType,
				documentNumber: body.documentNumber,
				documentExpiry: body.documentExpiry,
				documentIssuedMunicipalityId: body.documentIssuedMunicipalityId,
				documentImage: body.documentImage,
			});

			logger.info(
				{ sellerId: sp.id, action: "request_document_change" },
				"Seller document change requested",
			);

			return send(c, ChangeRes, ok(data));
		},
	)
	.patch(
		"/settings/changes/:changeId/cancel",
		doc({
			response: withErrors({ 200: ChangeRes }),
			detail: detail(
				"Annulla richiesta di modifica",
				"Annulla una richiesta di modifica ancora in attesa. Per la partita IVA toglie anche il blocco dei nuovi ordini. Solo il titolare.",
			),
		}),
		v("param", z.object({ changeId: z.string() })),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await cancelSellerChange({
				sellerProfileId: sp.id,
				changeId: c.req.valid("param").changeId,
			});

			logger.info(
				{
					sellerId: sp.id,
					changeId: data.id,
					action: "cancel_seller_change",
				},
				"Seller change request cancelled",
			);

			return send(c, ChangeRes, ok(data));
		},
	)
	.post(
		"/settings/payments/onboarding",
		doc({
			response: withErrors({ 200: LinkRes }),
			detail: detail(
				"Link di attivazione pagamenti online",
				"Crea il conto Stripe Connect del venditore se manca e restituisce il link all'onboarding ospitato da Stripe. Il link scade in pochi minuti. Solo il titolare.",
			),
		}),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await createOnboardingLink({
				sellerProfileId: sp.id,
				email: c.var.user.email,
			});
			logger.info(
				{ sellerId: sp.id, action: "connect_onboarding_link" },
				"Connect onboarding link created",
			);
			return send(c, LinkRes, ok(data));
		},
	)
	.post(
		"/settings/payments/sync",
		doc({
			response: withErrors({ 200: PaymentsRes }),
			detail: detail(
				"Aggiorna stato pagamenti online",
				"Rilegge il conto Stripe Connect e aggiorna lo stato salvato. Da chiamare al ritorno dall'onboarding. Solo il titolare.",
			),
		}),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			return send(c, PaymentsRes, ok(await syncOnlinePayments(sp.id)));
		},
	);
