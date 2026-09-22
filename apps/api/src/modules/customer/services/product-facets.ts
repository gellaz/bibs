import { eq, exists, sql } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { product, storeProduct } from "@/db/schemas/product";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { store } from "@/db/schemas/store";
import { openNowCondition } from "@/lib/store-open-status";
import {
	offerConditions,
	type ProductFilterParams,
	productConditions,
} from "./product-search-conditions";

export type ProductFacetParams = Omit<
	ProductFilterParams,
	"categoryId" | "macroCategoryId"
>;

export interface ProductCategoryFacet {
	id: string;
	name: string;
	productCount: number;
}

export interface ProductMacroFacet {
	id: string;
	name: string;
	productCount: number;
	categories: ProductCategoryFacet[];
}

export interface ProductFacets {
	/** Prodotti che corrispondono, indipendentemente dalla categoria — la riga "Tutte". */
	total: number;
	/** Quanti se si accende "Aperti ora". */
	openNowTotal: number;
	/** Quanti se si accende "Solo in offerta". */
	onSaleTotal: number;
	macros: ProductMacroFacet[];
}

/**
 * Conteggi per il rail di `/products`.
 *
 * Due regole, entrambe ereditate da `getStoreFacets()`:
 *
 * 1. I facet non applicano mai la categoria già selezionata — la domanda è
 *    "quanti prodotti restano se aggiungo questo filtro", e le alternative
 *    devono restare visibili e contate. Per questo il tipo non ha nemmeno i
 *    campi `categoryId`/`macroCategoryId`.
 * 2. `openNowTotal` e `onSaleTotal` si misurano ciascuno **senza il proprio**
 *    filtro: a filtro acceso coincidono con `total`, e la query in più si salta.
 *
 * Con una sola sotto-categoria per prodotto, la somma dei figli **coincide**
 * ora con il totale della macro: un prodotto compare in una sola categoria,
 * quindi in una sola macro. Restano comunque due query raggruppate separate
 * — una emette la lista delle macro, l'altra quella delle categorie — e
 * `count(DISTINCT products.id)` resta come guardia a costo zero, nel caso un
 * join futuro torni a moltiplicare le righe.
 *
 * Qui il laterale non serve: per contare basta sapere che esiste almeno un
 * negozio idoneo, non quale sia. Un `EXISTS` sulle stesse `offerConditions()`
 * è più semplice e più veloce della join laterale usata da `searchProducts()`.
 */
export async function getProductFacets(
	params: ProductFacetParams,
): Promise<ProductFacets> {
	// Mai la categoria scelta, qualunque cosa arrivi dal chiamante.
	const base: ProductFilterParams = {
		...params,
		categoryId: undefined,
		macroCategoryId: undefined,
	};

	const openCondition = await openNowCondition(new Date());

	/** Esiste almeno un negozio idoneo? Per contare non serve sapere quale. */
	const offerExists = (open: ReturnType<typeof sql> | null) =>
		exists(
			db
				.select({ one: sql`1` })
				.from(storeProduct)
				.innerJoin(store, eq(store.id, storeProduct.storeId))
				.where(sql.join(offerConditions(base, open), sql` AND `)),
		);

	const whereFor = (opts: { onSale: boolean; openNow: boolean }) =>
		sql.join(
			[
				...productConditions({ ...base, onSale: opts.onSale }),
				offerExists(opts.openNow ? openCondition : null),
			],
			sql` AND `,
		);

	const baseOnSale = base.onSale === true;
	const baseOpenNow = base.openNow === true;
	const whereClause = whereFor({ onSale: baseOnSale, openNow: baseOpenNow });

	const countProducts = (where: ReturnType<typeof sql>) =>
		db
			.select({ total: sql<number>`count(DISTINCT products.id)::int` })
			.from(product)
			.where(where);

	const [macroRows, categoryRows, [{ total }], openNowRows, onSaleRows] =
		await Promise.all([
			db
				.select({
					macroId: productMacroCategory.id,
					macroName: productMacroCategory.name,
					productCount: sql<number>`count(DISTINCT products.id)::int`,
				})
				.from(product)
				.innerJoin(
					productCategory,
					eq(productCategory.id, product.productCategoryId),
				)
				.innerJoin(
					productMacroCategory,
					eq(productMacroCategory.id, productCategory.macroCategoryId),
				)
				.where(whereClause)
				.groupBy(productMacroCategory.id, productMacroCategory.name)
				.orderBy(sql`${productMacroCategory.name} ASC`),
			db
				.select({
					macroId: productMacroCategory.id,
					categoryId: productCategory.id,
					categoryName: productCategory.name,
					productCount: sql<number>`count(DISTINCT products.id)::int`,
				})
				.from(product)
				.innerJoin(
					productCategory,
					eq(productCategory.id, product.productCategoryId),
				)
				.innerJoin(
					productMacroCategory,
					eq(productMacroCategory.id, productCategory.macroCategoryId),
				)
				.where(whereClause)
				.groupBy(
					productMacroCategory.id,
					productCategory.id,
					productCategory.name,
				)
				.orderBy(sql`${productCategory.name} ASC`),
			countProducts(whereClause),
			baseOpenNow
				? Promise.resolve(null)
				: countProducts(whereFor({ onSale: baseOnSale, openNow: true })),
			baseOnSale
				? Promise.resolve(null)
				: countProducts(whereFor({ onSale: true, openNow: baseOpenNow })),
		]);

	const categoriesByMacro = new Map<string, ProductCategoryFacet[]>();
	for (const row of categoryRows) {
		const list = categoriesByMacro.get(row.macroId) ?? [];
		list.push({
			id: row.categoryId,
			name: row.categoryName,
			productCount: row.productCount,
		});
		categoriesByMacro.set(row.macroId, list);
	}

	return {
		total,
		openNowTotal: openNowRows?.[0].total ?? total,
		onSaleTotal: onSaleRows?.[0].total ?? total,
		// Le macro a zero non arrivano nemmeno: una macro senza prodotti non
		// produce righe nel GROUP BY.
		macros: macroRows.map((row) => ({
			id: row.macroId,
			name: row.macroName,
			productCount: row.productCount,
			categories: categoriesByMacro.get(row.macroId) ?? [],
		})),
	};
}
