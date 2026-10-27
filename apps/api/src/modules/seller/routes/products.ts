import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okMessage, okPage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { ServiceError } from "@/lib/errors";
import {
	SellerProductDetailSchema,
	SellerProductListItemSchema,
} from "@/lib/schemas/composed";
import {
	BulkDeleteBody,
	BulkDeleteResult,
	BulkStatusBody,
	BulkStatusResult,
	EanLookupResultSchema,
	ProductCategoryWithMacroSchema,
	ProductCsvImportResultSchema,
	ProductSchema,
	ProductStatusBody,
	ProductStatusCounts,
} from "@/lib/schemas/entities";
import {
	CharacteristicValuesField,
	CreateProductBody,
	VatRateSchema,
} from "@/lib/schemas/forms/products";
import { PaginationQuery } from "@/lib/schemas/pagination";
import {
	OkMessage,
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas/responses";
import { zFile, zInteger, zString } from "@/lib/schemas/t";
import { ensureStoreAccess } from "../context";
import { importProductsFromCsv } from "../services/product-import";
import {
	bulkDeletePermanent,
	bulkUpdateProductStatus,
	createProduct,
	deleteProduct,
	getProduct,
	getProductStatusCounts,
	listCategoriesInUse,
	listProducts,
	lookupProductByEan,
	updateProduct,
	updateProductStatus,
} from "../services/products";

const d = (description: string) => ({ description });
const security = [{ bearerAuth: [] }];
const tags = ["Seller - Products"];

const price = (description: string) =>
	z
		.string()
		.regex(/^\d+(\.\d{1,2})?$/)
		.meta(d(description))
		.optional();

const ListQuery = PaginationQuery.extend({
	storeId: z
		.string()
		.meta(d("ID del negozio attivo (se assente: seller-wide)"))
		.optional(),
	statusFilter: z
		.enum(["active", "disabled", "trashed"])
		.meta(d("Filtra per stato. Default 'active'."))
		.default("active")
		.optional(),
	brandId: z.string().meta(d("Filtra per marca")).optional(),
	productCategoryIds: z
		.array(z.string())
		.meta(
			d(
				"Filtra per una o più categorie foglia. Repeated query param: `?productCategoryIds=a&productCategoryIds=b`. AND fra dimensioni, OR fra le categorie passate.",
			),
		)
		.optional(),
	productMacroCategoryId: z
		.string()
		.meta(d("Filtra per macro-categoria"))
		.optional(),
	minPrice: price("Prezzo minimo"),
	maxPrice: price("Prezzo massimo"),
	inStock: z.boolean().meta(d("Solo prodotti con stock>0")).optional(),
	excludeDiscountId: z
		.string()
		.meta(d("Escludi prodotti già in questa promo"))
		.optional(),
	q: zString({
		maxLength: 100,
		description:
			"Ricerca testuale su nome, descrizione, EAN e brand. Full-text con prefix matching e fuzzy (typo) tolerance. Minimo 2 caratteri effettivi.",
	}).optional(),
	sort: z
		.enum(["name", "price", "ean", "stock", "createdAt", "updatedAt"])
		.meta(
			d(
				"Campo di ordinamento. `stock` richiede `storeId`. Ignorato quando `q` è attivo (vince la rilevanza). Default: createdAt.",
			),
		)
		.optional(),
	order: z
		.enum(["asc", "desc"])
		.meta(d("Direzione di ordinamento. Default: desc."))
		.optional(),
});

const LookupQuery = z.object({
	ean: z
		.string()
		.regex(/^(\d{8}|\d{13})$/)
		.meta(d("Codice EAN-8 o EAN-13")),
});

const CategoriesInUseQuery = z.object({
	storeId: z
		.string()
		.meta(d("Restringe al negozio specificato; assente = seller-wide."))
		.optional(),
	statusFilter: z
		.enum(["active", "disabled", "trashed"])
		.meta(
			d(
				"Restringe ai prodotti dello stato indicato. Assente = qualunque status.",
			),
		)
		.optional(),
});

const StatusCountsQuery = z.object({
	storeId: z.string().meta(d("ID del negozio attivo")),
});

const ProductParams = z.object({
	productId: z.string().meta(d("ID del prodotto")),
});

const UpdateProductBody = z.object({
	productCategoryId: z
		.union([z.string(), z.null()])
		.meta(d("ID della sotto-categoria del prodotto. null per rimuoverla."))
		.optional(),
	name: zString({
		minLength: 1,
		maxLength: 200,
		description: "Nome del prodotto",
	}).optional(),
	description: zString({
		maxLength: 2000,
		description: "Descrizione del prodotto",
	}).optional(),
	price: z
		.string()
		.regex(/^\d+\.\d{2}$/)
		.meta(d("Prezzo (formato decimale, es. '9.99')"))
		.optional(),
	vatRate: VatRateSchema.optional(),
	imageOrder: z
		.array(z.string())
		.meta(
			d(
				"IDs delle immagini esistenti nell'ordine desiderato. La prima diventa l'immagine di default.",
			),
		)
		.optional(),
	ean: z
		.union([z.string().regex(/^$|^(\d{8}|\d{13})$/), z.null()])
		.meta(d("Codice EAN (null o stringa vuota per cancellarlo)"))
		.optional(),
	brandId: z
		.union([z.string(), z.null()])
		.meta(d("ID brand esistente (null per rimuovere)"))
		.optional(),
	brandName: zString({
		minLength: 1,
		maxLength: 120,
		description: "Nome brand da creare (ignorato se brandId valorizzato)",
	}).optional(),
	characteristicValues: CharacteristicValuesField.optional(),
	confirmAffected: zInteger({
		minimum: 0,
		description:
			"Solo al cambio di sotto-categoria: quanti valori già salvati, fuori dalla nuova matrice, l'interfaccia ha mostrato nella conferma. Se se ne perdono di più, 409 e nulla cambia. Assente vale 0.",
	}).optional(),
});

const ImportBody = z.object({
	file: zFile({
		type: "text/csv",
		description: "File CSV con i prodotti da importare",
	}),
	storeId: z.string().meta(d("ID del negozio attivo")),
});

const ProductListRes = okPageRes(SellerProductListItemSchema);
const LookupRes = okRes(z.union([EanLookupResultSchema, z.null()]));
const CategoriesInUseRes = okRes(z.array(ProductCategoryWithMacroSchema));
const StatusCountsRes = okRes(ProductStatusCounts);
const ProductDetailRes = okRes(SellerProductDetailSchema);
const ProductRes = okRes(ProductSchema);
const ImportRes = okRes(ProductCsvImportResultSchema);
const BulkStatusRes = okRes(BulkStatusResult);
const BulkDeleteRes = okRes(BulkDeleteResult);

// Route relative: il modulo è montato su /seller (`src/app.ts`). Le route
// statiche (`/products/lookup`, …) prima di `/products/:productId`: in Hono
// risponde la prima registrata.
export const productsRoutes = new Hono()
	.get(
		"/products",
		doc({
			response: withErrors({ 200: ProductListRes }),
			detail: {
				summary: "Lista prodotti del venditore",
				description:
					"Restituisce i prodotti del venditore filtrati per stato e filtri opzionali. Senza storeId, lista seller-wide. Con `q` attiva ricerca testuale ordinata per rilevanza.",
				tags,
				security,
			},
		}),
		v("query", ListQuery),
		requireSeller,
		async (c) => {
			const {
				sellerProfile: sp,
				isOwner,
				accessCtx,
				getAccessibleStoreIds,
			} = c.var.seller;
			const query = c.req.valid("query");
			if (query.storeId) {
				await ensureStoreAccess(query.storeId, accessCtx);
			}
			// Employees without an explicit storeId must only see products in
			// their assigned stores (owners see the whole catalog).
			const restrictToStoreIds =
				!query.storeId && !isOwner ? await getAccessibleStoreIds() : undefined;
			const result = await listProducts({
				sellerProfileId: sp.id,
				storeId: query.storeId,
				restrictToStoreIds,
				page: query.page,
				limit: query.limit,
				statusFilter: query.statusFilter,
				brandId: query.brandId,
				productCategoryIds: query.productCategoryIds,
				productMacroCategoryId: query.productMacroCategoryId,
				minPrice: query.minPrice,
				maxPrice: query.maxPrice,
				inStock: query.inStock,
				excludeDiscountId: query.excludeDiscountId,
				q: query.q,
				sort: query.sort,
				order: query.order,
			});
			return send(c, ProductListRes, okPage(result.data, result.pagination));
		},
	)
	.get(
		"/products/lookup",
		doc({
			response: withErrors({ 200: LookupRes }),
			detail: {
				summary: "Lookup prodotto per EAN",
				description:
					"Restituisce i dati pre-compilabili dell'ultimo prodotto attivo con questo EAN presente in un negozio visibile al pubblico (tra venditori: solo dati già pubblici sul sito). Esclude prezzo e immagini. Ritorna null se nessun prodotto matcha.",
				tags,
				security,
			},
		}),
		v("query", LookupQuery),
		requireSeller,
		async (c) => {
			const data = await lookupProductByEan({ ean: c.req.valid("query").ean });
			return send(c, LookupRes, ok(data));
		},
	)
	.get(
		"/products/categories-in-use",
		doc({
			response: withErrors({ 200: CategoriesInUseRes }),
			detail: {
				summary: "Categorie usate dal seller",
				description:
					"Restituisce le sotto-categorie con almeno un prodotto del seller. Filtrabile per negozio e/o status. Pensato per popolare il filtro categoria nella lista prodotti senza mostrare l'intero catalogo globale.",
				tags,
				security,
			},
		}),
		v("query", CategoriesInUseQuery),
		requireSeller,
		async (c) => {
			const {
				sellerProfile: sp,
				isOwner,
				accessCtx,
				getAccessibleStoreIds,
			} = c.var.seller;
			const query = c.req.valid("query");
			if (query.storeId) {
				await ensureStoreAccess(query.storeId, accessCtx);
			}
			const restrictToStoreIds =
				!query.storeId && !isOwner ? await getAccessibleStoreIds() : undefined;
			const data = await listCategoriesInUse({
				sellerProfileId: sp.id,
				storeId: query.storeId,
				statusFilter: query.statusFilter,
				restrictToStoreIds,
			});
			return send(c, CategoriesInUseRes, ok(data));
		},
	)
	.get(
		"/products/status-counts",
		doc({
			response: withErrors({ 200: StatusCountsRes }),
			detail: {
				summary: "Conta prodotti per stato",
				description:
					"Ritorna il numero di prodotti per ciascun stato (active/disabled/trashed) nel negozio specificato.",
				tags,
				security,
			},
		}),
		v("query", StatusCountsQuery),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, accessCtx } = c.var.seller;
			const { storeId } = c.req.valid("query");
			await ensureStoreAccess(storeId, accessCtx);
			const counts = await getProductStatusCounts({
				sellerProfileId: sp.id,
				storeId,
			});
			return send(c, StatusCountsRes, ok(counts));
		},
	)
	.get(
		"/products/:productId",
		doc({
			response: withErrors({ 200: ProductDetailRes }),
			detail: {
				summary: "Dettaglio prodotto",
				description:
					"Restituisce un singolo prodotto con la sua sotto-categoria, disponibilità per negozio, immagini e i valori delle caratteristiche.",
				tags,
				security,
			},
		}),
		v("param", ProductParams),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, getAccessibleStoreIds } = c.var.seller;
			const data = await getProduct({
				productId: c.req.valid("param").productId,
				sellerProfileId: sp.id,
				accessibleStoreIds: await getAccessibleStoreIds(),
			});
			return send(c, ProductDetailRes, ok(data));
		},
	)
	.post(
		"/products",
		doc({
			response: withConflictErrors({ 200: ProductRes }),
			detail: {
				summary: "Crea prodotto",
				description:
					"Crea un nuovo prodotto e lo associa alla sotto-categoria indicata. Il prodotto è attivo di default. Salva anche i valori delle caratteristiche: le obbligatorie della sotto-categoria vanno tutte compilate.",
				tags,
				security,
			},
		}),
		v("json", CreateProductBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, accessCtx } = c.var.seller;
			const body = c.req.valid("json");
			await ensureStoreAccess(body.storeId, accessCtx);
			const data = await createProduct({ sellerProfileId: sp.id, ...body });

			logger.info(
				{
					userId: c.var.user.id,
					sellerProfileId: sp.id,
					productId: data.id,
					productName: data.name,
					storeId: body.storeId,
					productCategoryId: body.productCategoryId,
					ean: data.ean,
					brandId: data.brandId,
					action: "product_created",
				},
				"Nuovo prodotto creato",
			);

			return send(c, ProductRes, ok(data));
		},
	)
	.patch(
		"/products/:productId",
		doc({
			response: withConflictErrors({ 200: ProductRes }),
			detail: {
				summary: "Aggiorna prodotto",
				description:
					"Aggiorna i dati di un prodotto. Se viene fornita productCategoryId, la classificazione viene sostituita; null la rimuove. Salva i valori delle caratteristiche; un'obbligatoria già compilata non si può svuotare. Cambiando sotto-categoria si perdono i valori fuori dalla nuova matrice, dietro confirmAffected, e le nuove obbligatorie vanno compilate.",
				tags,
				security,
			},
		}),
		v("param", ProductParams),
		v("json", UpdateProductBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, getAccessibleStoreIds } = c.var.seller;
			const data = await updateProduct({
				productId: c.req.valid("param").productId,
				sellerProfileId: sp.id,
				accessibleStoreIds: await getAccessibleStoreIds(),
				...c.req.valid("json"),
			});

			if (!data) throw new ServiceError(404, "Prodotto non trovato");
			return send(c, ProductRes, ok(data));
		},
	)
	.post(
		"/products/import",
		doc({
			response: withErrors({ 200: ImportRes }),
			detail: {
				summary: "Importa prodotti da CSV",
				description:
					"Importa prodotti in blocco da un file CSV. Colonne attese: name, description, price, categories (una o più categorie separate da ';'; il prodotto tiene solo la prima, le altre sono riportate in `warnings`). Colonne opzionali: ean (8 o 13 cifre), brand (match-or-create per venditore). Restituisce il numero di prodotti creati, le righe saltate per EAN duplicato, gli errori per riga (`failed` conta solo questi) e gli avvisi per riga.",
				tags,
				security,
			},
		}),
		v("form", ImportBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, accessCtx } = c.var.seller;
			const body = c.req.valid("form");
			await ensureStoreAccess(body.storeId, accessCtx);
			const csvText = await body.file.text();
			const result = await importProductsFromCsv({
				sellerProfileId: sp.id,
				storeId: body.storeId,
				csvText,
			});

			logger.info(
				{
					userId: c.var.user.id,
					sellerProfileId: sp.id,
					created: result.created,
					failed: result.failed,
					action: "products_imported",
					storeId: body.storeId,
				},
				"Importazione prodotti da CSV completata",
			);

			return send(c, ImportRes, ok(result));
		},
	)
	.patch(
		"/products/:productId/status",
		doc({
			response: withConflictErrors({ 200: ProductRes }),
			detail: {
				summary: "Aggiorna stato prodotto",
				description:
					"Cambia lo stato del prodotto (active/disabled/trashed). Scrive un'entry sull'audit log se lo stato cambia. No-op se lo stato è già quello richiesto.",
				tags,
				security,
			},
		}),
		v("param", ProductParams),
		v("json", ProductStatusBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, getAccessibleStoreIds } = c.var.seller;
			const user = c.var.user;
			const updated = await updateProductStatus({
				productId: c.req.valid("param").productId,
				sellerProfileId: sp.id,
				accessibleStoreIds: await getAccessibleStoreIds(),
				actorUserId: user.id,
				status: c.req.valid("json").status,
			});

			logger.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					productId: updated.id,
					status: updated.status,
					action: "product_status_updated",
				},
				"Stato prodotto aggiornato",
			);

			return send(c, ProductRes, ok(updated));
		},
	)
	.post(
		"/products/bulk/status",
		doc({
			response: withErrors({ 200: BulkStatusRes }),
			detail: {
				summary: "Cambia stato di più prodotti",
				description:
					"Imposta lo stato (active/disabled/trashed) di più prodotti in un'unica chiamata. Best-effort: gli ID inaccessibili o non trovati finiscono in 'failed' con la reason. Limite: 100 ID per chiamata.",
				tags,
				security,
			},
		}),
		v("json", BulkStatusBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, getAccessibleStoreIds } = c.var.seller;
			const user = c.var.user;
			const body = c.req.valid("json");
			const result = await bulkUpdateProductStatus({
				sellerProfileId: sp.id,
				accessibleStoreIds: await getAccessibleStoreIds(),
				actorUserId: user.id,
				productIds: body.productIds,
				status: body.status,
			});

			logger.info(
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

			return send(c, BulkStatusRes, ok(result));
		},
	)
	.post(
		"/products/bulk/delete-permanent",
		doc({
			response: withErrors({ 200: BulkDeleteRes }),
			detail: {
				summary: "Elimina definitivamente più prodotti",
				description:
					"Elimina fisicamente più prodotti dal cestino in un'unica chiamata. Solo i prodotti con status='trashed' vengono eliminati; gli altri finiscono in 'failed'. Limite: 100 ID per chiamata.",
				tags,
				security,
			},
		}),
		v("json", BulkDeleteBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, getAccessibleStoreIds } = c.var.seller;
			const { productIds } = c.req.valid("json");
			const result = await bulkDeletePermanent({
				sellerProfileId: sp.id,
				accessibleStoreIds: await getAccessibleStoreIds(),
				productIds,
			});

			logger.warn(
				{
					userId: c.var.user.id,
					sellerProfileId: sp.id,
					requested: productIds.length,
					succeeded: result.succeeded.length,
					failed: result.failed.length,
					action: "products_bulk_deleted_permanently",
				},
				"Bulk delete fisico prodotti",
			);

			return send(c, BulkDeleteRes, ok(result));
		},
	)
	.delete(
		"/products/:productId",
		doc({
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina prodotto definitivamente",
				description:
					"Elimina fisicamente un prodotto e tutti i dati associati (immagini, stock, classificazioni). Richiede che il prodotto sia in cestino (status='trashed'); altrimenti restituisce 409. Per nascondere un prodotto senza eliminarlo, usa PATCH /:id/status con status='disabled' o 'trashed'.",
				tags,
				security,
			},
		}),
		v("param", ProductParams),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, getAccessibleStoreIds } = c.var.seller;
			const deleted = await deleteProduct({
				productId: c.req.valid("param").productId,
				sellerProfileId: sp.id,
				accessibleStoreIds: await getAccessibleStoreIds(),
			});

			logger.warn(
				{
					userId: c.var.user.id,
					sellerProfileId: sp.id,
					productId: deleted.id,
					productName: deleted.name,
					action: "product_deleted",
				},
				"Prodotto eliminato",
			);

			return send(c, OkMessage, okMessage("Prodotto eliminato"));
		},
	);
