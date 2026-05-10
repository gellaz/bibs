import { Elysia, t } from "elysia";
import { ServiceError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	BulkStatusBody,
	BulkStatusResult,
	CsvImportResultSchema,
	EanLookupResultSchema,
	OkMessage,
	okPageRes,
	okRes,
	ProductSchema,
	ProductStatusBody,
	ProductWithRelationsSchema,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { CreateProductBody } from "@/lib/schemas/forms";
import { ensureStoreAccess, withSeller } from "../context";
import { importProductsFromCsv } from "../services/product-import";
import {
	bulkUpdateProductStatus,
	createProduct,
	deleteProduct,
	getProduct,
	listProducts,
	lookupProductByEan,
	updateProduct,
	updateProductStatus,
} from "../services/products";

export const productsRoutes = new Elysia()
	.get(
		"/products",
		async (ctx) => {
			const { sellerProfile: sp, query, isOwner, user } = withSeller(ctx);
			await ensureStoreAccess(query.storeId, {
				userId: user.id,
				sellerProfileId: sp.id,
				isOwner,
			});
			const result = await listProducts({
				sellerProfileId: sp.id,
				storeId: query.storeId,
				page: query.page,
				limit: query.limit,
			});
			return okPage(result.data, result.pagination);
		},
		{
			query: t.Composite([
				PaginationQuery,
				t.Object({
					storeId: t.String({ description: "ID del negozio attivo" }),
				}),
			]),
			response: withErrors({ 200: okPageRes(ProductWithRelationsSchema) }),
			detail: {
				summary: "Lista prodotti del negozio",
				description:
					"Restituisce i prodotti disponibili nel negozio specificato (filtrati via store_products).",
				tags: ["Seller - Products"],
			},
		},
	)
	.get(
		"/products/lookup",
		async ({ query }) => {
			const data = await lookupProductByEan({ ean: query.ean });
			return ok(data);
		},
		{
			query: t.Object({
				ean: t.String({
					pattern: "^(\\d{8}|\\d{13})$",
					description: "Codice EAN-8 o EAN-13",
				}),
			}),
			auth: true,
			response: withErrors({
				200: okRes(t.Union([EanLookupResultSchema, t.Null()])),
			}),
			detail: {
				summary: "Lookup prodotto per EAN",
				description:
					"Restituisce i dati pre-compilabili dell'ultimo prodotto creato con questo EAN (cross-seller). Esclude prezzo e immagini. Ritorna null se nessun prodotto matcha.",
				tags: ["Seller - Products"],
			},
		},
	)
	.get(
		"/products/:productId",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params } = sellerCtx;
			const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();
			const data = await getProduct({
				productId: params.productId,
				sellerProfileId: sp.id,
				accessibleStoreIds,
			});
			return ok(data);
		},
		{
			params: t.Object({
				productId: t.String({ description: "ID del prodotto" }),
			}),
			response: withErrors({ 200: okRes(ProductWithRelationsSchema) }),
			detail: {
				summary: "Dettaglio prodotto",
				description:
					"Restituisce un singolo prodotto con categorie, disponibilità per negozio e immagini.",
				tags: ["Seller - Products"],
			},
		},
	)
	.post(
		"/products",
		async (ctx) => {
			const { sellerProfile: sp, body, user, store, isOwner } = withSeller(ctx);
			const pino = getLogger(store);
			await ensureStoreAccess(body.storeId, {
				userId: user.id,
				sellerProfileId: sp.id,
				isOwner,
			});
			const data = await createProduct({ sellerProfileId: sp.id, ...body });

			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					productId: data.id,
					productName: data.name,
					storeId: body.storeId,
					categoryIds: body.categoryIds,
					ean: data.ean,
					brandId: data.brandId,
					action: "product_created",
				},
				"Nuovo prodotto creato",
			);

			return ok(data);
		},
		{
			body: CreateProductBody,
			response: withErrors({ 200: okRes(ProductSchema) }),
			detail: {
				summary: "Crea prodotto",
				description:
					"Crea un nuovo prodotto e lo associa alle categorie indicate. Il prodotto è attivo di default.",
				tags: ["Seller - Products"],
			},
		},
	)
	.patch(
		"/products/:productId",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params, body } = sellerCtx;
			const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();
			const data = await updateProduct({
				productId: params.productId,
				sellerProfileId: sp.id,
				accessibleStoreIds,
				...body,
			});

			if (!data) throw new ServiceError(404, "Product not found");
			return ok(data);
		},
		{
			params: t.Object({
				productId: t.String({ description: "ID del prodotto" }),
			}),
			body: t.Object({
				categoryIds: t.Optional(
					t.Array(t.String(), {
						description:
							"Nuove categorie (sostituisce le precedenti). Array vuoto per rimuoverle tutte.",
					}),
				),
				name: t.Optional(
					t.String({
						minLength: 1,
						maxLength: 200,
						description: "Nome del prodotto",
					}),
				),
				description: t.Optional(
					t.String({
						maxLength: 2000,
						description: "Descrizione del prodotto",
					}),
				),
				price: t.Optional(
					t.String({
						pattern: "^\\d+\\.\\d{2}$",
						description: "Prezzo (formato decimale, es. '9.99')",
					}),
				),
				imageOrder: t.Optional(
					t.Array(t.String(), {
						description:
							"IDs delle immagini esistenti nell'ordine desiderato. La prima diventa l'immagine di default.",
					}),
				),
				ean: t.Optional(
					t.Union([t.String({ pattern: "^$|^(\\d{8}|\\d{13})$" }), t.Null()], {
						description: "Codice EAN (null o stringa vuota per cancellarlo)",
					}),
				),
				brandId: t.Optional(
					t.Union([t.String(), t.Null()], {
						description: "ID brand esistente (null per rimuovere)",
					}),
				),
				brandName: t.Optional(
					t.String({
						minLength: 1,
						maxLength: 120,
						description:
							"Nome brand da creare (ignorato se brandId valorizzato)",
					}),
				),
			}),
			response: withErrors({ 200: okRes(ProductSchema) }),
			detail: {
				summary: "Aggiorna prodotto",
				description:
					"Aggiorna i dati di un prodotto. Se vengono fornite categoryIds, le classificazioni vengono sostituite.",
				tags: ["Seller - Products"],
			},
		},
	)
	.post(
		"/products/import",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, body, user, store, isOwner } = sellerCtx;
			await ensureStoreAccess(body.storeId, {
				userId: user.id,
				sellerProfileId: sp.id,
				isOwner,
			});
			const pino = getLogger(store);
			const csvText = await body.file.text();
			const result = await importProductsFromCsv({
				sellerProfileId: sp.id,
				storeId: body.storeId,
				csvText,
			});

			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					created: result.created,
					failed: result.failed,
					action: "products_imported",
					storeId: body.storeId,
				},
				"Importazione prodotti da CSV completata",
			);

			return ok(result);
		},
		{
			body: t.Object({
				file: t.File({
					type: "text/csv",
					description: "File CSV con i prodotti da importare",
				}),
				storeId: t.String({ description: "ID del negozio attivo" }),
			}),
			response: withErrors({ 200: okRes(CsvImportResultSchema) }),
			detail: {
				summary: "Importa prodotti da CSV",
				description:
					"Importa prodotti in blocco da un file CSV. Colonne attese: name, description, price, categories (nomi separati da ';'). Colonne opzionali: ean (8 o 13 cifre), brand (match-or-create per venditore). Restituisce il numero di prodotti creati, le righe saltate per EAN duplicato, e gli eventuali errori per riga.",
				tags: ["Seller - Products"],
			},
		},
	)
	.patch(
		"/products/:productId/status",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params, body, user, store } = sellerCtx;
			const pino = getLogger(store);
			const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();

			const updated = await updateProductStatus({
				productId: params.productId,
				sellerProfileId: sp.id,
				accessibleStoreIds,
				actorUserId: user.id,
				status: body.status,
			});

			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					productId: updated.id,
					status: updated.status,
					action: "product_status_updated",
				},
				"Stato prodotto aggiornato",
			);

			return ok(updated);
		},
		{
			params: t.Object({
				productId: t.String({ description: "ID del prodotto" }),
			}),
			body: ProductStatusBody,
			response: withErrors({ 200: okRes(ProductSchema) }),
			detail: {
				summary: "Aggiorna stato prodotto",
				description:
					"Cambia lo stato del prodotto (active/disabled/trashed). Scrive un'entry sull'audit log se lo stato cambia. No-op se lo stato è già quello richiesto.",
				tags: ["Seller - Products"],
			},
		},
	)
	.post(
		"/products/bulk/status",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, body, user, store } = sellerCtx;
			const pino = getLogger(store);
			const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();

			const result = await bulkUpdateProductStatus({
				sellerProfileId: sp.id,
				accessibleStoreIds,
				actorUserId: user.id,
				productIds: body.productIds,
				status: body.status,
			});

			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					requested: body.productIds.length,
					succeeded: result.succeeded.length,
					failed: result.failed.length,
					status: body.status,
					action: "products_bulk_status_updated",
				},
				"Bulk update di stato prodotti",
			);

			return ok(result);
		},
		{
			body: BulkStatusBody,
			response: withErrors({ 200: okRes(BulkStatusResult) }),
			detail: {
				summary: "Cambia stato di più prodotti",
				description:
					"Imposta lo stato (active/disabled/trashed) di più prodotti in un'unica chiamata. Best-effort: gli ID inaccessibili o non trovati finiscono in 'failed' con la reason. Limite: 100 ID per chiamata.",
				tags: ["Seller - Products"],
			},
		},
	)
	.delete(
		"/products/:productId",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params, user, store } = sellerCtx;
			const pino = getLogger(store);
			const accessibleStoreIds = await sellerCtx.getAccessibleStoreIds();

			const deleted = await deleteProduct({
				productId: params.productId,
				sellerProfileId: sp.id,
				accessibleStoreIds,
			});

			pino.warn(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					productId: deleted.id,
					productName: deleted.name,
					action: "product_deleted",
				},
				"Prodotto eliminato",
			);

			return okMessage("Product deleted");
		},
		{
			params: t.Object({
				productId: t.String({ description: "ID del prodotto" }),
			}),
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina prodotto definitivamente",
				description:
					"Elimina fisicamente un prodotto e tutti i dati associati (immagini, stock, classificazioni). Richiede che il prodotto sia in cestino (status='trashed'); altrimenti restituisce 409. Per nascondere un prodotto senza eliminarlo, usa PATCH /:id/status con status='disabled' o 'trashed'.",
				tags: ["Seller - Products"],
			},
		},
	);
