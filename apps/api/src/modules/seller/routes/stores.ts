import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okPage } from "@/lib/responses";
import {
	AddressFieldsOptional,
	MunicipalityCompactSchema,
	okPageRes,
	okRes,
	StoreWithPhonesSchema,
	withErrors,
} from "@/lib/schemas";
import { CreateStoreBody } from "@/lib/schemas/forms";
import { requireOwner, withSeller } from "../context";
import {
	cancelStoreSubscription,
	createStore,
	listArchivedStores,
	listStores,
	reactivateStoreSubscription,
	updateStore,
} from "../services/stores";

const ArchivedStoreSchema = t.Object({
	id: t.String(),
	name: t.String(),
	addressLine1: t.String(),
	municipalityId: t.String(),
	municipality: MunicipalityCompactSchema,
	createdAt: t.Date(),
	deletedAt: t.Nullable(t.Date()),
	canceledAt: t.Nullable(t.Date()),
	cancelReason: t.Nullable(t.String()),
});

export const storesRoutes = new Elysia()
	.get(
		"/stores",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, isOwner, query } = sellerCtx;
			// Owner: undefined filter = all stores. Employee: explicit list = only assigned stores (may be empty).
			const filterStoreIds = isOwner
				? undefined
				: await sellerCtx.getAccessibleStoreIds();
			const result = await listStores({
				sellerProfileId: sp.id,
				filterStoreIds,
				page: query.page,
				limit: query.limit,
			});
			return okPage(result.data, result.pagination);
		},
		{
			query: PaginationQuery,
			response: withErrors({ 200: okPageRes(StoreWithPhonesSchema) }),
			detail: {
				summary: "Lista negozi",
				description: "Restituisce la lista paginata dei negozi del venditore.",
				tags: ["Seller - Stores"],
			},
		},
	)
	.post(
		"/stores",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, body, user, store } = withSeller(ctx);
			const pino = getLogger(store);
			requireOwner(isOwner);

			const data = await createStore({ sellerProfileId: sp.id, ...body });

			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					storeId: data.id,
					storeName: data.name,
					action: "store_created",
				},
				"Nuovo negozio creato",
			);

			return ok(data);
		},
		{
			body: CreateStoreBody,
			response: withErrors({ 200: okRes(StoreWithPhonesSchema) }),
			detail: {
				summary: "Crea negozio",
				description:
					"Crea un nuovo negozio per il venditore. Solo il proprietario può creare negozi.",
				tags: ["Seller - Stores"],
			},
		},
	)
	.patch(
		"/stores/:storeId",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params, body } = withSeller(ctx);
			requireOwner(isOwner);

			const data = await updateStore({
				storeId: params.storeId,
				sellerProfileId: sp.id,
				...body,
			});
			return ok(data);
		},
		{
			params: t.Object({
				storeId: t.String({ description: "ID del negozio" }),
			}),
			body: t.Object({
				name: t.Optional(
					t.String({
						minLength: 1,
						maxLength: 100,
						description: "Nome del negozio",
					}),
				),
				description: t.Optional(
					t.String({ maxLength: 1000, description: "Descrizione" }),
				),
				...AddressFieldsOptional,
				categoryId: t.Optional(
					t.Nullable(t.String({ description: "ID categoria negozio" })),
				),
				openingHours: t.Optional(
					t.Nullable(
						t.Array(
							t.Object({
								dayOfWeek: t.Integer({
									minimum: 0,
									maximum: 6,
								}),
								slots: t.Array(
									t.Object({
										open: t.String(),
										close: t.String(),
									}),
								),
							}),
							{ description: "Orari di apertura" },
						),
					),
				),
				websiteUrl: t.Optional(
					t.String({
						format: "uri",
						maxLength: 500,
						description: "URL del sito web",
					}),
				),
				phoneNumbers: t.Optional(
					t.Array(
						t.Object({
							label: t.Optional(
								t.String({
									maxLength: 50,
									description: "Etichetta (es. 'Principale')",
								}),
							),
							number: t.String({
								minLength: 5,
								maxLength: 30,
								description: "Numero di telefono",
							}),
							position: t.Optional(
								t.Number({
									minimum: 0,
									description: "Posizione di ordinamento",
								}),
							),
						}),
						{ description: "Numeri di telefono del negozio" },
					),
				),
			}),
			response: withErrors({ 200: okRes(StoreWithPhonesSchema) }),
			detail: {
				summary: "Aggiorna negozio",
				description:
					"Aggiorna i dati di un negozio esistente. Solo il proprietario può modificare negozi.",
				tags: ["Seller - Stores"],
			},
		},
	)
	.delete(
		"/stores/:storeId",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params } = withSeller(ctx);
			requireOwner(isOwner);

			const data = await cancelStoreSubscription({
				sellerProfileId: sp.id,
				storeId: params.storeId,
			});
			return ok(data);
		},
		{
			params: t.Object({
				storeId: t.String({ description: "ID del negozio" }),
			}),
			response: withErrors({
				200: okRes(
					t.Object({
						status: t.Union([t.Literal("canceling"), t.Literal("canceled")]),
						effectiveAt: t.Date(),
					}),
				),
			}),
			detail: {
				summary: "Cancella subscription negozio",
				description:
					"Cancel at period end per active/past_due (idempotente su canceling). Cancel immediato per suspended.",
				tags: ["Seller - Stores"],
			},
		},
	)
	.post(
		"/stores/:storeId/reactivate",
		async (ctx) => {
			const { sellerProfile: sp, isOwner, params } = withSeller(ctx);
			requireOwner(isOwner);

			const data = await reactivateStoreSubscription({
				sellerProfileId: sp.id,
				storeId: params.storeId,
			});
			return ok(data);
		},
		{
			params: t.Object({
				storeId: t.String({ description: "ID del negozio" }),
			}),
			response: withErrors({
				200: okRes(t.Object({ status: t.Literal("active") })),
			}),
			detail: {
				summary: "Annulla la cancellazione in corso",
				description: "Solo per status='canceling' prima del period end.",
				tags: ["Seller - Stores"],
			},
		},
	)
	.get(
		"/stores/archived",
		async (ctx) => {
			const { sellerProfile: sp, query } = withSeller(ctx);
			const data = await listArchivedStores({
				sellerProfileId: sp.id,
				page: query.page ?? 1,
				limit: query.limit ?? 25,
			});
			return ok(data);
		},
		{
			query: t.Object({
				page: t.Optional(t.Integer({ minimum: 1 })),
				limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
			}),
			response: withErrors({
				200: okRes(
					t.Object({
						data: t.Array(ArchivedStoreSchema),
						pagination: t.Object({
							page: t.Integer(),
							limit: t.Integer(),
							total: t.Integer(),
						}),
					}),
				),
			}),
			detail: {
				summary: "Lista negozi archiviati del seller",
				description:
					"Negozi con deletedAt impostato. Include canceledAt e cancelReason via join su store_subscriptions.",
				tags: ["Seller - Stores"],
			},
		},
	);
