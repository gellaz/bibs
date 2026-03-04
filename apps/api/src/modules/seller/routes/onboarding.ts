import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import {
	okRes,
	SellerProfileSchema,
	StoreSchema,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withSellerAuth } from "../context";
import {
	createOnboardingStore,
	getOnboardingStatus,
	updateCompany,
	updateDocument,
	updatePayment,
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
			body: t.Object({
				firstName: t.String({ description: "Nome" }),
				lastName: t.String({ description: "Cognome" }),
				citizenship: t.String({ description: "Cittadinanza" }),
				birthCountry: t.String({ description: "Paese di nascita" }),
				birthDate: t.String({
					pattern: "^\\d{4}-\\d{2}-\\d{2}$",
					description: "Data di nascita (YYYY-MM-DD)",
				}),
				residenceCountry: t.String({
					description: "Paese di residenza",
				}),
				residenceCity: t.String({ description: "Città di residenza" }),
				residenceAddress: t.String({
					description: "Indirizzo di residenza",
				}),
				residenceZipCode: t.String({ description: "CAP residenza" }),
			}),
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
				documentIssuedMunicipality: body.documentIssuedMunicipality,
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
				documentNumber: t.String({
					description: "Numero carta d'identità",
				}),
				documentExpiry: t.String({
					pattern: "^\\d{4}-\\d{2}-\\d{2}$",
					description: "Scadenza documento (YYYY-MM-DD)",
				}),
				documentIssuedMunicipality: t.String({
					description: "Comune di rilascio",
				}),
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
			body: t.Object({
				businessName: t.String({ description: "Ragione sociale" }),
				vatNumber: t.String({
					pattern: "^[0-9]{11}$",
					description: "Partita IVA italiana (11 cifre)",
				}),
				legalForm: t.String({
					description: "Forma giuridica (es. SRL, SAS, Ditta individuale)",
				}),
				addressLine1: t.String({
					description: "Indirizzo sede legale",
				}),
				country: t.Optional(
					t.String({
						description: "Codice paese (default: IT)",
					}),
				),
				province: t.Optional(t.String({ description: "Provincia (sigla)" })),
				city: t.String({ description: "Città" }),
				zipCode: t.String({ description: "CAP" }),
			}),
			response: withConflictErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Step 3: Dati aziendali",
				description:
					"Inserisce le informazioni aziendali / societarie. Richiede onboardingStatus = 'pending_company'.",
				tags: ["Seller - Onboarding"],
			},
		},
	)
	.post(
		"/store",
		async (ctx) => {
			const { user, body, store: ctxStore } = withSellerAuth(ctx);
			const pino = getLogger(ctxStore);
			const data = await createOnboardingStore({
				userId: user.id,
				...body,
			});

			pino.info(
				{
					userId: user.id,
					storeId: data.store.id,
					storeName: data.store.name,
					action: "onboarding_store",
				},
				"Seller first store created",
			);

			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({ description: "Nome del negozio" }),
				description: t.Optional(
					t.String({ description: "Descrizione del negozio" }),
				),
				addressLine1: t.String({ description: "Indirizzo negozio" }),
				province: t.Optional(t.String({ description: "Provincia (sigla)" })),
				city: t.String({ description: "Città" }),
				zipCode: t.String({ description: "CAP" }),
				categoryId: t.Optional(
					t.String({ description: "ID categoria negozio" }),
				),
				openingHours: t.Optional(
					t.Unknown({ description: "Orari di apertura (JSON)" }),
				),
				useCompanyAddress: t.Optional(
					t.Boolean({
						description: "Se true, copia l'indirizzo dall'azienda registrata",
					}),
				),
			}),
			response: withErrors({
				200: okRes(
					t.Object({
						profile: SellerProfileSchema,
						store: StoreSchema,
					}),
				),
			}),
			detail: {
				summary: "Step 4: Primo negozio",
				description:
					"Crea il primo negozio del venditore. Richiede onboardingStatus = 'pending_store'. Se useCompanyAddress=true, l'indirizzo viene copiato dall'azienda.",
				tags: ["Seller - Onboarding"],
			},
		},
	)
	.patch(
		"/payment",
		async (ctx) => {
			const { user, store } = withSellerAuth(ctx);
			const pino = getLogger(store);
			const data = await updatePayment({
				userId: user.id,
				stripeAccountId: (ctx as any).body?.stripeAccountId,
			});

			pino.info(
				{ userId: user.id, action: "onboarding_payment" },
				"Seller payment method configured",
			);

			return ok(data);
		},
		{
			body: t.Object({
				stripeAccountId: t.Optional(
					t.String({
						description: "ID dell'account Stripe Connect",
					}),
				),
			}),
			response: withErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Step 5: Metodo di pagamento",
				description:
					"Configura il metodo di pagamento del venditore. Richiede onboardingStatus = 'pending_payment'. Dopo questo step l'onboarding passa in revisione admin.",
				tags: ["Seller - Onboarding"],
			},
		},
	);
