import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { ok, okPage } from "@/lib/responses";
import { StoreWithPhonesSchema } from "@/lib/zod/composed";
import {
	AddressFieldsOptional,
	MunicipalityCompactSchema,
	ReservationDeadlineSchema,
	StoreOrderTypesSchema,
} from "@/lib/zod/entities";
import { OpeningHoursSchema } from "@/lib/zod/forms/opening-hours";
import { CreateStoreBody } from "@/lib/zod/forms/stores";
import { PaginationQuery } from "@/lib/zod/pagination";
import {
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/zod/responses";
import { utf16Length, zDate, zFormat, zInteger, zString } from "@/lib/zod/t";
import { ensureStoreAccess, requireOwner } from "../context";
import {
	getStoreOrderTypes,
	previewReservationDeadline,
	updateStoreOrderTypes,
} from "../services/order-types";
import {
	cancelStoreSubscription,
	createStore,
	listArchivedStores,
	listStores,
	reactivateStoreSubscription,
	updateStore,
} from "../services/stores";

const ArchivedStoreSchema = z.object({
	id: z.string(),
	name: z.string(),
	addressLine1: z.string(),
	municipalityId: z.string(),
	municipality: MunicipalityCompactSchema,
	createdAt: zDate(),
	deletedAt: zDate().nullable(),
	canceledAt: zDate().nullable(),
	cancelReason: z.string().nullable(),
	subscriptionStatus: z
		.string()
		.meta({
			description:
				"Stato dell'abbonamento; 'canceled' = riattivabile con POST /stores/:storeId/reactivation-checkout",
		})
		.nullable(),
});

const storeId = z.object({
	storeId: z.string().meta({ description: "ID del negozio" }),
});

const reservationHours = (description: string) =>
	zInteger({
		minimum: config.reservationHours.min,
		maximum: config.reservationHours.max,
		description,
	});

const UpdateStoreBody = z.object({
	name: zString({
		minLength: 1,
		maxLength: 100,
		description: "Nome del negozio",
	}).optional(),
	description: zString({
		maxLength: 1000,
		description: "Descrizione",
	}).optional(),
	...AddressFieldsOptional,
	categoryId: z
		.string()
		.meta({ description: "ID categoria negozio" })
		.nullable()
		.optional(),
	openingHours: OpeningHoursSchema.nullable().optional(),
	reservationHours: reservationHours(
		"Ore di apertura entro cui il cliente ritira una prenotazione (Prenota e paga in negozio)",
	).optional(),
	lowStockThreshold: zInteger({
		minimum: 0,
		maximum: 9999,
		description:
			"Soglia di scorta bassa: sotto questo stock (escluso) un prodotto attivo è segnalato nella home. 0 spegne l'avviso",
	}).optional(),
	// `.max()` per /openapi, `utf16Length` per contare come TypeBox (vedi forms/stores.ts).
	websiteUrl: zFormat("uri")
		.max(500)
		.check(utf16Length({ maxLength: 500 }))
		.meta({ description: "URL del sito web. null per rimuoverlo" })
		.nullable()
		.optional(),
	phoneNumbers: z
		.array(
			z.object({
				label: zString({
					maxLength: 50,
					description: "Etichetta (es. 'Principale')",
				}).optional(),
				number: zString({
					minLength: 5,
					maxLength: 30,
					description: "Numero di telefono",
				}),
				position: zInteger({
					minimum: 0,
					description: "Posizione di ordinamento",
				}).optional(),
			}),
		)
		.meta({ description: "Numeri di telefono del negozio" })
		.optional(),
});

const OrderTypesBody = z.object({
	orderTypes: z
		.array(z.enum(["reserve_pickup", "pay_pickup"]))
		.min(1)
		.refine((types) => new Set(types).size === types.length, {
			params: { rule: { kind: "uniqueItems" } },
		})
		.meta({
			uniqueItems: true,
			description: "Tipologie d'acquisto accettate dal negozio",
		}),
});

const ArchivedQuery = z.object({
	page: zInteger({ minimum: 1 }).optional(),
	limit: zInteger({ minimum: 1, maximum: 100 }).optional(),
});

const StoreRes = okRes(StoreWithPhonesSchema);
const StorePage = okPageRes(StoreWithPhonesSchema);
const DeadlineRes = okRes(ReservationDeadlineSchema);
const OrderTypesRes = okRes(StoreOrderTypesSchema);
const CancelRes = okRes(
	z.object({
		status: z.enum(["canceling", "canceled"]),
		effectiveAt: zDate(),
	}),
);
const ReactivateRes = okRes(z.object({ status: z.literal("active") }));
const ArchivedRes = okRes(
	z.object({
		data: z.array(ArchivedStoreSchema),
		pagination: z.object({
			page: zInteger(),
			limit: zInteger(),
			total: zInteger(),
		}),
	}),
);

const detail = (summary: string, description: string) => ({
	summary,
	description,
	tags: ["Seller - Stores"],
	security: [{ bearerAuth: [] }],
});

export const storesRoutes = new Hono()
	.get(
		"/stores",
		doc({
			response: withErrors({ 200: StorePage }),
			detail: detail(
				"Lista negozi",
				"Restituisce la lista paginata dei negozi del venditore.",
			),
		}),
		v("query", PaginationQuery),
		requireSeller,
		async (c) => {
			const {
				sellerProfile: sp,
				isOwner,
				getAccessibleStoreIds,
			} = c.var.seller;
			const query = c.req.valid("query");
			// Owner: undefined filter = all stores. Employee: explicit list = only assigned stores (may be empty).
			const filterStoreIds = isOwner
				? undefined
				: await getAccessibleStoreIds();
			const result = await listStores({
				sellerProfileId: sp.id,
				filterStoreIds,
				page: query.page,
				limit: query.limit,
			});
			return send(c, StorePage, okPage(result.data, result.pagination));
		},
	)
	.post(
		"/stores",
		doc({
			response: withErrors({ 200: StoreRes }),
			detail: detail(
				"Crea negozio",
				"Crea un nuovo negozio per il venditore. Solo il proprietario può creare negozi.",
			),
		}),
		v("json", CreateStoreBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);

			const data = await createStore({
				sellerProfileId: sp.id,
				...c.req.valid("json"),
			});

			logger.info(
				{
					userId: c.var.user.id,
					sellerProfileId: sp.id,
					storeId: data.id,
					storeName: data.name,
					action: "store_created",
				},
				"Nuovo negozio creato",
			);

			return send(c, StoreRes, ok(data));
		},
	)
	.patch(
		"/stores/:storeId",
		doc({
			response: withErrors({ 200: StoreRes }),
			detail: detail(
				"Aggiorna negozio",
				"Aggiorna i dati di un negozio esistente. Solo il proprietario può modificare negozi.",
			),
		}),
		v("param", storeId),
		v("json", UpdateStoreBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);

			const data = await updateStore({
				storeId: c.req.valid("param").storeId,
				sellerProfileId: sp.id,
				...c.req.valid("json"),
			});
			return send(c, StoreRes, ok(data));
		},
	)
	.get(
		"/stores/:storeId/reservation-preview",
		doc({
			response: withErrors({ 200: DeadlineRes }),
			detail: detail(
				"Anteprima della scadenza di una prenotazione",
				"Scadenza che avrebbe una prenotazione fatta adesso con queste ore, contate sulle ore di apertura del negozio (calendario se il negozio non ha orari). Non salva nulla. Solo il titolare.",
			),
		}),
		v("param", storeId),
		v(
			"query",
			z.object({
				hours: reservationHours(
					"Ore di apertura da provare, anche non ancora salvate",
				),
			}),
		),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await previewReservationDeadline({
				sellerProfileId: sp.id,
				storeId: c.req.valid("param").storeId,
				hours: c.req.valid("query").hours,
			});
			return send(c, DeadlineRes, ok(data));
		},
	)
	.get(
		"/stores/:storeId/order-types",
		doc({
			response: withErrors({ 200: OrderTypesRes }),
			detail: detail(
				"Tipologie d'acquisto del negozio",
				"Tipologie configurate, quelle offerte davvero ai clienti e se il venditore può incassare online. Titolare e dipendenti assegnati al negozio.",
			),
		}),
		v("param", storeId),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, accessCtx } = c.var.seller;
			const id = c.req.valid("param").storeId;
			await ensureStoreAccess(id, accessCtx);
			const data = await getStoreOrderTypes({
				sellerProfileId: sp.id,
				storeId: id,
			});
			return send(c, OrderTypesRes, ok(data));
		},
	)
	.patch(
		"/stores/:storeId/order-types",
		doc({
			response: withErrors({ 200: OrderTypesRes }),
			detail: detail(
				"Aggiorna tipologie d'acquisto",
				"«Paga e ritira» si attiva solo con i pagamenti online abilitati; deve restare almeno una tipologia offerta ai clienti. Solo il titolare.",
			),
		}),
		v("param", storeId),
		v("json", OrderTypesBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const data = await updateStoreOrderTypes({
				sellerProfileId: sp.id,
				storeId: c.req.valid("param").storeId,
				orderTypes: c.req.valid("json").orderTypes,
			});
			return send(c, OrderTypesRes, ok(data));
		},
	)
	.delete(
		"/stores/:storeId",
		doc({
			response: withErrors({ 200: CancelRes }),
			detail: detail(
				"Cancella subscription negozio",
				"Cancel at period end per active/past_due (idempotente su canceling). Cancel immediato per suspended.",
			),
		}),
		v("param", storeId),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);

			const data = await cancelStoreSubscription({
				sellerProfileId: sp.id,
				storeId: c.req.valid("param").storeId,
			});
			return send(c, CancelRes, ok(data));
		},
	)
	.post(
		"/stores/:storeId/reactivate",
		doc({
			response: withConflictErrors({ 200: ReactivateRes }),
			detail: detail(
				"Annulla la cancellazione in corso",
				"Solo per status='canceling' prima del period end.",
			),
		}),
		v("param", storeId),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);

			const data = await reactivateStoreSubscription({
				sellerProfileId: sp.id,
				storeId: c.req.valid("param").storeId,
			});
			return send(c, ReactivateRes, ok(data));
		},
	)
	.get(
		"/stores/archived",
		doc({
			response: withErrors({ 200: ArchivedRes }),
			detail: detail(
				"Lista negozi archiviati del seller",
				"Negozi con deletedAt impostato. Include canceledAt e cancelReason via join su store_subscriptions.",
			),
		}),
		v("query", ArchivedQuery),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const query = c.req.valid("query");
			const data = await listArchivedStores({
				sellerProfileId: sp.id,
				page: query.page ?? 1,
				limit: query.limit ?? 25,
			});
			return send(c, ArchivedRes, ok(data));
		},
	);
