import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	OkMessage,
	okRes,
	StockAdjustBody,
	StockBulkAdjustBody,
	StockBulkAdjustResult,
	StoreProductSchema,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { ensureStoreAccess, withSeller } from "../context";
import {
	adjustStock,
	assignProductToStores,
	bulkAdjustStock,
	removeProductFromStore,
	updateStock,
} from "../services/stock";

export const stockRoutes = new Elysia()
	.post(
		"/products/:productId/stores",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params, body, isOwner, user } = sellerCtx;
			for (const storeId of body.storeIds) {
				await ensureStoreAccess(storeId, {
					userId: user.id,
					sellerProfileId: sp.id,
					isOwner,
				});
			}
			const data = await assignProductToStores({
				productId: params.productId,
				sellerProfileId: sp.id,
				storeIds: body.storeIds,
				stock: body.stock,
			});
			return ok(data);
		},
		{
			params: t.Object({
				productId: t.String({ description: "ID del prodotto" }),
			}),
			body: t.Object({
				storeIds: t.Array(t.String({ description: "ID negozio" }), {
					minItems: 1,
					description: "Negozi in cui rendere disponibile il prodotto",
				}),
				stock: t.Optional(
					t.Number({
						minimum: 0,
						description:
							"Stock iniziale per i negozi appena collegati (default: 0). Se omesso, lo stock dei negozi già collegati viene preservato; se valorizzato, sovrascrive anche i link esistenti.",
					}),
				),
			}),
			response: withErrors({ 200: okRes(t.Array(StoreProductSchema)) }),
			detail: {
				summary: "Assegna prodotto a negozi",
				description:
					"Collega un prodotto a uno o più negozi del venditore con lo stock iniziale indicato.",
				tags: ["Seller - Stock"],
			},
		},
	)
	.patch(
		"/products/:productId/stores/:storeId",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params, body, isOwner, user } = sellerCtx;
			await ensureStoreAccess(params.storeId, {
				userId: user.id,
				sellerProfileId: sp.id,
				isOwner,
			});
			const data = await updateStock({
				productId: params.productId,
				storeId: params.storeId,
				sellerProfileId: sp.id,
				stock: body.stock,
			});
			return ok(data);
		},
		{
			params: t.Object({
				productId: t.String({ description: "ID del prodotto" }),
				storeId: t.String({ description: "ID del negozio" }),
			}),
			body: t.Object({
				stock: t.Number({ minimum: 0, description: "Nuova quantità di stock" }),
			}),
			response: withErrors({ 200: okRes(StoreProductSchema) }),
			detail: {
				summary: "Aggiorna stock",
				description:
					"Aggiorna la quantità di stock di un prodotto in un negozio specifico.",
				tags: ["Seller - Stock"],
			},
		},
	)
	.post(
		"/products/:productId/stores/:storeId/stock-adjust",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const {
				sellerProfile: sp,
				params,
				body,
				isOwner,
				user,
				store,
			} = sellerCtx;
			const pino = getLogger(store);
			await ensureStoreAccess(params.storeId, {
				userId: user.id,
				sellerProfileId: sp.id,
				isOwner,
			});
			const data = await adjustStock({
				productId: params.productId,
				storeId: params.storeId,
				sellerProfileId: sp.id,
				delta: body.delta,
			});
			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					productId: params.productId,
					storeId: params.storeId,
					delta: body.delta,
					newStock: data.stock,
					action: "stock_adjusted",
				},
				"Stock modificato",
			);
			return ok(data);
		},
		{
			params: t.Object({
				productId: t.String({ description: "ID del prodotto" }),
				storeId: t.String({ description: "ID del negozio" }),
			}),
			body: StockAdjustBody,
			response: withConflictErrors({ 200: okRes(StoreProductSchema) }),
			detail: {
				summary: "Adegua stock (delta atomico)",
				description:
					"Applica un delta atomico allo stock corrente del prodotto in un negozio. Restituisce 409 se l'operazione porterebbe lo stock sotto zero. Pensato per gli step ±1 della UI seller.",
				tags: ["Seller - Stock"],
			},
		},
	)
	.post(
		"/products/bulk/stock-adjust",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, body, isOwner, user, store } = sellerCtx;
			const pino = getLogger(store);
			await ensureStoreAccess(body.storeId, {
				userId: user.id,
				sellerProfileId: sp.id,
				isOwner,
			});
			const result = await bulkAdjustStock({
				sellerProfileId: sp.id,
				storeId: body.storeId,
				productIds: body.productIds,
				mode: body.mode,
				value: body.value,
			});
			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					storeId: body.storeId,
					mode: body.mode,
					value: body.value,
					requested: body.productIds.length,
					succeeded: result.succeeded.length,
					failed: result.failed.length,
					action: "stock_bulk_adjusted",
				},
				"Bulk adjust stock",
			);
			return ok(result);
		},
		{
			body: StockBulkAdjustBody,
			response: withErrors({ 200: okRes(StockBulkAdjustResult) }),
			detail: {
				summary: "Adegua stock in bulk",
				description:
					"Applica un delta (mode='delta') o imposta un valore assoluto (mode='set') allo stock di più prodotti in un singolo negozio. Best-effort: gli ID non accessibili o con stock insufficiente finiscono in 'failed' con reason. Limite: 100 ID per chiamata.",
				tags: ["Seller - Stock"],
			},
		},
	)
	.delete(
		"/products/:productId/stores/:storeId",
		async (ctx) => {
			const sellerCtx = withSeller(ctx);
			const { sellerProfile: sp, params, isOwner, user } = sellerCtx;
			await ensureStoreAccess(params.storeId, {
				userId: user.id,
				sellerProfileId: sp.id,
				isOwner,
			});
			await removeProductFromStore({
				productId: params.productId,
				storeId: params.storeId,
				sellerProfileId: sp.id,
			});
			return okMessage("Store-product link deleted");
		},
		{
			params: t.Object({
				productId: t.String({ description: "ID del prodotto" }),
				storeId: t.String({ description: "ID del negozio" }),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi prodotto da negozio",
				description:
					"Rimuove l'associazione tra un prodotto e un negozio (e il relativo stock).",
				tags: ["Seller - Stock"],
			},
		},
	);
