import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okMessage, okPage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import {
	DiscountAddResultSchema,
	DiscountCreateBody,
	DiscountListItemSchema,
	DiscountListQuery,
	DiscountProductRowSchema,
	DiscountProductsBody,
	DiscountRemoveResultSchema,
	DiscountSchema,
	DiscountUpdateBody,
} from "@/lib/schemas/discount";
import { PaginationQuery } from "@/lib/schemas/pagination";
import {
	OkMessage,
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas/responses";
import { zInteger } from "@/lib/schemas/t";
import { requireOwner } from "../context";
import {
	addProductsToDiscount,
	archiveDiscount,
	createDiscount,
	getDiscountById,
	getDiscountProducts,
	listDiscounts,
	pauseDiscount,
	removeProductsFromDiscount,
	updateDiscount,
} from "../services/discounts";

const security = [{ bearerAuth: [] }];
const tags = ["Seller - Discounts"];

const DiscountParams = z.object({ discountId: z.string() });

const ListRes = okPageRes(DiscountListItemSchema);
const DetailRes = okRes(DiscountSchema.extend({ productCount: zInteger() }));
const ProductsRes = okPageRes(DiscountProductRowSchema);
const DiscountRes = okRes(DiscountSchema);
const AddRes = okRes(DiscountAddResultSchema);
const RemoveRes = okRes(DiscountRemoveResultSchema);

export const discountsRoutes = new Hono()
	.get(
		"/discounts",
		doc({
			response: withErrors({ 200: ListRes }),
			detail: {
				summary: "Lista promozioni",
				description:
					"Elenca le promozioni del venditore. Filtro 'state': 'assignable' (in corso/programmate/in pausa, default) o 'concluded' (scadute/archiviate).",
				tags,
				security,
			},
		}),
		v("query", DiscountListQuery),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const query = c.req.valid("query");
			const result = await listDiscounts({
				sellerProfileId: sp.id,
				page: query.page,
				limit: query.limit,
				state: query.state,
				search: query.search,
			});
			return send(c, ListRes, okPage(result.data, result.pagination));
		},
	)
	.get(
		"/discounts/:discountId",
		doc({
			response: withErrors({ 200: DetailRes }),
			detail: {
				summary: "Dettaglio promozione",
				description:
					"Restituisce una promozione con il conteggio dei prodotti associati.",
				tags,
				security,
			},
		}),
		v("param", DiscountParams),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const d = await getDiscountById({
				discountId: c.req.valid("param").discountId,
				sellerProfileId: sp.id,
			});
			return send(c, DetailRes, ok(d));
		},
	)
	.get(
		"/discounts/:discountId/products",
		doc({
			response: withErrors({ 200: ProductsRes }),
			detail: {
				summary: "Prodotti inclusi nella promozione",
				description:
					"Lista paginata dei prodotti inclusi, con prezzo originale e scontato.",
				tags,
				security,
			},
		}),
		v("param", DiscountParams),
		v("query", PaginationQuery),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const query = c.req.valid("query");
			const out = await getDiscountProducts({
				discountId: c.req.valid("param").discountId,
				sellerProfileId: sp.id,
				page: query.page,
				limit: query.limit,
			});
			return send(c, ProductsRes, okPage(out.data, out.pagination));
		},
	)
	.post(
		"/discounts",
		doc({
			response: withErrors({ 200: DiscountRes }),
			detail: {
				summary: "Crea promozione",
				description:
					"Crea una nuova promozione del venditore, opzionalmente con prodotti iniziali.",
				tags,
				security,
			},
		}),
		v("json", DiscountCreateBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const body = c.req.valid("json");
			const d = await createDiscount({
				sellerProfileId: sp.id,
				title: body.title,
				percent: body.percent,
				startsAt: body.startsAt,
				endsAt: body.endsAt ?? null,
			});
			if (body.initialProductIds?.length) {
				await addProductsToDiscount({
					discountId: d.id,
					sellerProfileId: sp.id,
					productIds: body.initialProductIds,
				});
			}
			logger.info(
				{
					userId: c.var.user.id,
					sellerProfileId: sp.id,
					discountId: d.id,
					percent: d.percent,
					initialProductCount: body.initialProductIds?.length ?? 0,
					action: "discount_created",
				},
				"Promozione creata",
			);
			return send(c, DiscountRes, ok(d));
		},
	)
	.patch(
		"/discounts/:discountId",
		doc({
			response: withConflictErrors({ 200: DiscountRes }),
			detail: {
				summary: "Modifica promozione",
				description:
					"Modifica i campi di una promozione. Percentuale e data di inizio non sono modificabili una volta partita.",
				tags,
				security,
			},
		}),
		v("param", DiscountParams),
		v("json", DiscountUpdateBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const out = await updateDiscount({
				discountId: c.req.valid("param").discountId,
				sellerProfileId: sp.id,
				patch: c.req.valid("json"),
			});
			return send(c, DiscountRes, ok(out));
		},
	)
	.post(
		"/discounts/:discountId/pause",
		doc({
			response: withConflictErrors({ 200: DiscountRes }),
			detail: {
				summary: "Pausa/riprendi promozione",
				description:
					"Toggle tra status 'active' e 'paused'. Errore 409 se archiviata.",
				tags,
				security,
			},
		}),
		v("param", DiscountParams),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const out = await pauseDiscount({
				discountId: c.req.valid("param").discountId,
				sellerProfileId: sp.id,
			});
			return send(c, DiscountRes, ok(out));
		},
	)
	.post(
		"/discounts/:discountId/archive",
		doc({
			response: withConflictErrors({ 200: DiscountRes }),
			detail: {
				summary: "Archivia promozione",
				description: "Imposta status='archived'. Errore 409 se già archiviata.",
				tags,
				security,
			},
		}),
		v("param", DiscountParams),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const out = await archiveDiscount({
				discountId: c.req.valid("param").discountId,
				sellerProfileId: sp.id,
			});
			return send(c, DiscountRes, ok(out));
		},
	)
	.post(
		"/discounts/:discountId/products",
		doc({
			response: withErrors({ 200: AddRes }),
			detail: {
				summary: "Aggiungi prodotti alla promozione",
				description:
					"Aggiunge prodotti (idempotente). I prodotti di altri venditori finiscono in 'rejected'. Limite 100 IDs.",
				tags,
				security,
			},
		}),
		v("param", DiscountParams),
		v("json", DiscountProductsBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const out = await addProductsToDiscount({
				discountId: c.req.valid("param").discountId,
				sellerProfileId: sp.id,
				productIds: c.req.valid("json").productIds,
			});
			return send(c, AddRes, ok(out));
		},
	)
	.delete(
		"/discounts/:discountId/products",
		doc({
			response: withErrors({ 200: RemoveRes }),
			detail: {
				summary: "Rimuovi prodotti dalla promozione",
				description: "Rimuove i prodotti specificati. Limite 100 IDs.",
				tags,
				security,
			},
		}),
		v("param", DiscountParams),
		v("json", DiscountProductsBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const out = await removeProductsFromDiscount({
				discountId: c.req.valid("param").discountId,
				sellerProfileId: sp.id,
				productIds: c.req.valid("json").productIds,
			});
			return send(c, RemoveRes, ok(out));
		},
	)
	.delete(
		"/discounts/:discountId/products/:productId",
		doc({
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi singolo prodotto",
				description: "Rimuove un solo prodotto dalla promozione.",
				tags,
				security,
			},
		}),
		v("param", z.object({ discountId: z.string(), productId: z.string() })),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			requireOwner(isOwner);
			const params = c.req.valid("param");
			await removeProductsFromDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				productIds: [params.productId],
			});
			return send(c, OkMessage, okMessage("Prodotto rimosso dalla promozione"));
		},
	);
