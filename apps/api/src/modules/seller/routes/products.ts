import { Elysia, t } from "elysia";
import { ServiceError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	CsvImportResultSchema,
	OkMessage,
	okPageRes,
	okRes,
	ProductSchema,
	ProductWithRelationsSchema,
	withErrors,
} from "@/lib/schemas";
import { withSeller } from "../context";
import { importProductsFromCsv } from "../services/product-import";
import {
	createProduct,
	deleteProduct,
	getProduct,
	listProducts,
	updateProduct,
} from "../services/products";

export const productsRoutes = new Elysia()
	.get(
		"/products",
		async (ctx) => {
			const { sellerProfile: sp, query } = withSeller(ctx);
			const result = await listProducts({ sellerProfileId: sp.id, ...query });
			return okPage(result.data, result.pagination);
		},
		{
			query: PaginationQuery,
			response: withErrors({ 200: okPageRes(ProductWithRelationsSchema) }),
			detail: {
				summary: "Lista prodotti",
				description:
					"Restituisce la lista paginata dei prodotti del venditore con categorie, disponibilità per negozio e immagini.",
				tags: ["Seller - Products"],
			},
		},
	)
	.get(
		"/products/:productId",
		async (ctx) => {
			const { sellerProfile: sp, params } = withSeller(ctx);
			const data = await getProduct({
				productId: params.productId,
				sellerProfileId: sp.id,
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
			const { sellerProfile: sp, body, user, store } = withSeller(ctx);
			const pino = getLogger(store);
			const data = await createProduct({ sellerProfileId: sp.id, ...body });

			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					productId: data.id,
					productName: data.name,
					categoryIds: body.categoryIds,
					action: "product_created",
				},
				"Nuovo prodotto creato",
			);

			return ok(data);
		},
		{
			body: t.Object({
				categoryIds: t.Array(t.String({ description: "ID categoria" }), {
					minItems: 1,
					description: "Almeno una categoria obbligatoria",
				}),
				name: t.String({
					minLength: 1,
					maxLength: 200,
					description: "Nome del prodotto",
				}),
				description: t.Optional(
					t.String({
						maxLength: 2000,
						description: "Descrizione del prodotto",
					}),
				),
				price: t.String({
					pattern: "^\\d+\\.\\d{2}$",
					description: "Prezzo (formato decimale, es. '9.99')",
				}),
			}),
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
			const { sellerProfile: sp, params, body } = withSeller(ctx);
			const data = await updateProduct({
				productId: params.productId,
				sellerProfileId: sp.id,
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
						minItems: 1,
						description: "Nuove categorie (sostituisce le precedenti)",
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
			const { sellerProfile: sp, body, user, store } = withSeller(ctx);
			const pino = getLogger(store);
			const csvText = await body.file.text();
			const result = await importProductsFromCsv({
				sellerProfileId: sp.id,
				csvText,
			});

			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					created: result.created,
					failed: result.failed,
					action: "products_imported",
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
			}),
			response: withErrors({ 200: okRes(CsvImportResultSchema) }),
			detail: {
				summary: "Importa prodotti da CSV",
				description:
					"Importa prodotti in blocco da un file CSV. Colonne attese: name, description, price, categories (nomi separati da ';'). Restituisce il numero di prodotti creati e gli eventuali errori per riga.",
				tags: ["Seller - Products"],
			},
		},
	)
	.delete(
		"/products/:productId",
		async (ctx) => {
			const { sellerProfile: sp, params, user, store } = withSeller(ctx);
			const pino = getLogger(store);

			const deleted = await deleteProduct({
				productId: params.productId,
				sellerProfileId: sp.id,
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
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina prodotto",
				description:
					"Elimina un prodotto e tutte le sue classificazioni, stock e immagini associate (cascade).",
				tags: ["Seller - Products"],
			},
		},
	);
