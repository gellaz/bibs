import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okMessage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { StoreProductSchema } from "@/lib/schemas/entities";
import {
	OkMessage,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas/responses";
import {
	StockAdjustBody,
	StockBulkAdjustBody,
	StockBulkAdjustResult,
} from "@/lib/schemas/stock";
import { zInteger } from "@/lib/schemas/t";
import { ensureStoreAccess } from "../context";
import {
	adjustStock,
	assignProductToStores,
	bulkAdjustStock,
	removeProductFromStore,
	updateStock,
} from "../services/stock";

const productId = z.string().meta({ description: "ID del prodotto" });
const ProductStoreParams = z.object({
	productId,
	storeId: z.string().meta({ description: "ID del negozio" }),
});

const AssignBody = z.object({
	storeIds: z
		.array(z.string().meta({ description: "ID negozio" }))
		.min(1)
		.meta({ description: "Negozi in cui rendere disponibile il prodotto" }),
	stock: zInteger({
		minimum: 0,
		description:
			"Stock iniziale per i negozi appena collegati (default: 0). Se omesso, lo stock dei negozi già collegati viene preservato; se valorizzato, sovrascrive anche i link esistenti.",
	}).optional(),
});

const UpdateStockBody = z.object({
	stock: zInteger({ minimum: 0, description: "Nuova quantità di stock" }),
});

const StoreProductRes = okRes(StoreProductSchema);
const StoreProductsRes = okRes(z.array(StoreProductSchema));
const BulkAdjustRes = okRes(StockBulkAdjustResult);

export const stockRoutes = new Hono()
	.post(
		"/products/:productId/stores",
		doc({
			response: withErrors({ 200: StoreProductsRes }),
			detail: {
				summary: "Assegna prodotto a negozi",
				description:
					"Collega un prodotto a uno o più negozi del venditore con lo stock iniziale indicato.",
				tags: ["Seller - Stock"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("param", z.object({ productId })),
		v("json", AssignBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, accessCtx } = c.var.seller;
			const params = c.req.valid("param");
			const body = c.req.valid("json");
			for (const storeId of body.storeIds) {
				await ensureStoreAccess(storeId, accessCtx);
			}
			const data = await assignProductToStores({
				productId: params.productId,
				sellerProfileId: sp.id,
				storeIds: body.storeIds,
				stock: body.stock,
			});
			return send(c, StoreProductsRes, ok(data));
		},
	)
	.patch(
		"/products/:productId/stores/:storeId",
		doc({
			response: withErrors({ 200: StoreProductRes }),
			detail: {
				summary: "Aggiorna stock",
				description:
					"Aggiorna la quantità di stock di un prodotto in un negozio specifico.",
				tags: ["Seller - Stock"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("param", ProductStoreParams),
		v("json", UpdateStockBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, accessCtx } = c.var.seller;
			const params = c.req.valid("param");
			await ensureStoreAccess(params.storeId, accessCtx);
			const data = await updateStock({
				productId: params.productId,
				storeId: params.storeId,
				sellerProfileId: sp.id,
				stock: c.req.valid("json").stock,
			});
			return send(c, StoreProductRes, ok(data));
		},
	)
	.post(
		"/products/:productId/stores/:storeId/stock-adjust",
		doc({
			response: withConflictErrors({ 200: StoreProductRes }),
			detail: {
				summary: "Adegua stock (delta atomico)",
				description:
					"Applica un delta atomico allo stock corrente del prodotto in un negozio. Restituisce 409 se l'operazione porterebbe lo stock sotto zero. Pensato per gli step ±1 della UI seller.",
				tags: ["Seller - Stock"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("param", ProductStoreParams),
		v("json", StockAdjustBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, accessCtx } = c.var.seller;
			const params = c.req.valid("param");
			const { delta } = c.req.valid("json");
			await ensureStoreAccess(params.storeId, accessCtx);
			const data = await adjustStock({
				productId: params.productId,
				storeId: params.storeId,
				sellerProfileId: sp.id,
				delta,
			});
			logger.info(
				{
					userId: c.var.user.id,
					sellerProfileId: sp.id,
					productId: params.productId,
					storeId: params.storeId,
					delta,
					newStock: data.stock,
					action: "stock_adjusted",
				},
				"Stock modificato",
			);
			return send(c, StoreProductRes, ok(data));
		},
	)
	.post(
		"/products/bulk/stock-adjust",
		doc({
			response: withErrors({ 200: BulkAdjustRes }),
			detail: {
				summary: "Adegua stock in bulk",
				description:
					"Applica un delta (mode='delta') o imposta un valore assoluto (mode='set') allo stock di più prodotti in un singolo negozio. Best-effort: gli ID non accessibili o con stock insufficiente finiscono in 'failed' con reason. Limite: 100 ID per chiamata.",
				tags: ["Seller - Stock"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("json", StockBulkAdjustBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, accessCtx } = c.var.seller;
			const body = c.req.valid("json");
			await ensureStoreAccess(body.storeId, accessCtx);
			const result = await bulkAdjustStock({
				sellerProfileId: sp.id,
				storeId: body.storeId,
				productIds: body.productIds,
				mode: body.mode,
				value: body.value,
			});
			logger.info(
				{
					userId: c.var.user.id,
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
			return send(c, BulkAdjustRes, ok(result));
		},
	)
	.delete(
		"/products/:productId/stores/:storeId",
		doc({
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi prodotto da negozio",
				description:
					"Rimuove l'associazione tra un prodotto e un negozio (e il relativo stock).",
				tags: ["Seller - Stock"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("param", ProductStoreParams),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, accessCtx } = c.var.seller;
			const params = c.req.valid("param");
			await ensureStoreAccess(params.storeId, accessCtx);
			await removeProductFromStore({
				productId: params.productId,
				storeId: params.storeId,
				sellerProfileId: sp.id,
			});
			return send(c, OkMessage, okMessage("Prodotto rimosso dal negozio"));
		},
	);
