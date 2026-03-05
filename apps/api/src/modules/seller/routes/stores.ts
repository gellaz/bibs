import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	AddressFieldsOptional,
	OkMessage,
	okPageRes,
	okRes,
	StoreWithPhonesSchema,
	withErrors,
} from "@/lib/schemas";
import { CreateStoreBody } from "@/lib/schemas/forms";
import { requireOwner, withSeller } from "../context";
import {
	createStore,
	deleteStore,
	listStores,
	updateStore,
} from "../services/stores";

export const storesRoutes = new Elysia()
	.get(
		"/stores",
		async (ctx) => {
			const { sellerProfile: sp, query } = withSeller(ctx);
			const result = await listStores({ sellerProfileId: sp.id, ...query });
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

			await deleteStore({ storeId: params.storeId, sellerProfileId: sp.id });
			return okMessage("Store deleted");
		},
		{
			params: t.Object({
				storeId: t.String({ description: "ID del negozio" }),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina negozio",
				description:
					"Elimina un negozio. Solo il proprietario può eliminare negozi.",
				tags: ["Seller - Stores"],
			},
		},
	);
