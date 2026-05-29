import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okMessage, okPage } from "@/lib/responses";
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
	OkMessage,
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { requireOwner, withSeller } from "../context";
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

export const discountsRoutes = new Elysia()
	.get(
		"/discounts",
		async (ctx) => {
			const { sellerProfile: sp, query, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const result = await listDiscounts({
				sellerProfileId: sp.id,
				page: query.page,
				limit: query.limit,
				state: query.state,
				search: query.search,
			});
			return okPage(result.data, result.pagination);
		},
		{
			query: DiscountListQuery,
			response: withErrors({ 200: okPageRes(DiscountListItemSchema) }),
			detail: {
				summary: "Lista promozioni",
				description:
					"Elenca le promozioni del venditore filtrate per stato operativo. Lo stato 'archived' è incluso solo quando esplicitamente richiesto.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.get(
		"/discounts/:discountId",
		async (ctx) => {
			const { sellerProfile: sp, params, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const d = await getDiscountById({
				discountId: params.discountId,
				sellerProfileId: sp.id,
			});
			return ok(d);
		},
		{
			params: t.Object({ discountId: t.String() }),
			response: withErrors({
				200: okRes(
					t.Object({
						...DiscountSchema.properties,
						productCount: t.Integer(),
					}),
				),
			}),
			detail: {
				summary: "Dettaglio promozione",
				description:
					"Restituisce una promozione con il conteggio dei prodotti associati.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.get(
		"/discounts/:discountId/products",
		async (ctx) => {
			const { sellerProfile: sp, params, query, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const out = await getDiscountProducts({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				page: query.page,
				limit: query.limit,
			});
			return okPage(out.data, out.pagination);
		},
		{
			params: t.Object({ discountId: t.String() }),
			query: PaginationQuery,
			response: withErrors({ 200: okPageRes(DiscountProductRowSchema) }),
			detail: {
				summary: "Prodotti inclusi nella promozione",
				description:
					"Lista paginata dei prodotti inclusi, con prezzo originale e scontato.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.post(
		"/discounts",
		async (ctx) => {
			const { sellerProfile: sp, body, user, store, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const pino = getLogger(store);
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
			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					discountId: d.id,
					percent: d.percent,
					initialProductCount: body.initialProductIds?.length ?? 0,
					action: "discount_created",
				},
				"Promozione creata",
			);
			return ok(d);
		},
		{
			body: DiscountCreateBody,
			response: withErrors({ 200: okRes(DiscountSchema) }),
			detail: {
				summary: "Crea promozione",
				description:
					"Crea una nuova promozione del venditore, opzionalmente con prodotti iniziali.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.patch(
		"/discounts/:discountId",
		async (ctx) => {
			const { sellerProfile: sp, params, body, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const out = await updateDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				patch: body,
			});
			return ok(out);
		},
		{
			params: t.Object({ discountId: t.String() }),
			body: DiscountUpdateBody,
			response: withConflictErrors({ 200: okRes(DiscountSchema) }),
			detail: {
				summary: "Modifica promozione",
				description:
					"Modifica i campi di una promozione. Percentuale e data di inizio non sono modificabili una volta partita.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.post(
		"/discounts/:discountId/pause",
		async (ctx) => {
			const { sellerProfile: sp, params, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const out = await pauseDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
			});
			return ok(out);
		},
		{
			params: t.Object({ discountId: t.String() }),
			response: withConflictErrors({ 200: okRes(DiscountSchema) }),
			detail: {
				summary: "Pausa/riprendi promozione",
				description:
					"Toggle tra status 'active' e 'paused'. Errore 409 se archiviata.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.post(
		"/discounts/:discountId/archive",
		async (ctx) => {
			const { sellerProfile: sp, params, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const out = await archiveDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
			});
			return ok(out);
		},
		{
			params: t.Object({ discountId: t.String() }),
			response: withConflictErrors({ 200: okRes(DiscountSchema) }),
			detail: {
				summary: "Archivia promozione",
				description: "Imposta status='archived'. Errore 409 se già archiviata.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.post(
		"/discounts/:discountId/products",
		async (ctx) => {
			const { sellerProfile: sp, params, body, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const out = await addProductsToDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				productIds: body.productIds,
			});
			return ok(out);
		},
		{
			params: t.Object({ discountId: t.String() }),
			body: DiscountProductsBody,
			response: withErrors({ 200: okRes(DiscountAddResultSchema) }),
			detail: {
				summary: "Aggiungi prodotti alla promozione",
				description:
					"Aggiunge prodotti (idempotente). I prodotti di altri venditori finiscono in 'rejected'. Limite 100 IDs.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.delete(
		"/discounts/:discountId/products",
		async (ctx) => {
			const { sellerProfile: sp, params, body, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			const out = await removeProductsFromDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				productIds: body.productIds,
			});
			return ok(out);
		},
		{
			params: t.Object({ discountId: t.String() }),
			body: DiscountProductsBody,
			response: withErrors({ 200: okRes(DiscountRemoveResultSchema) }),
			detail: {
				summary: "Rimuovi prodotti dalla promozione",
				description: "Rimuove i prodotti specificati. Limite 100 IDs.",
				tags: ["Seller - Discounts"],
			},
		},
	)
	.delete(
		"/discounts/:discountId/products/:productId",
		async (ctx) => {
			const { sellerProfile: sp, params, isOwner } = withSeller(ctx);
			requireOwner(isOwner);
			await removeProductsFromDiscount({
				discountId: params.discountId,
				sellerProfileId: sp.id,
				productIds: [params.productId],
			});
			return okMessage("Prodotto rimosso dalla promozione");
		},
		{
			params: t.Object({
				discountId: t.String(),
				productId: t.String(),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi singolo prodotto",
				description: "Rimuove un solo prodotto dalla promozione.",
				tags: ["Seller - Discounts"],
			},
		},
	);
