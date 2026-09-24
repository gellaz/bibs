import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { brand } from "@/db/schemas/brand";
import { productCategory } from "@/db/schemas/category";
import { municipality, province } from "@/db/schemas/location";
import { product, storeProduct } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";
import {
	type CustomerCharacteristic,
	listCustomerCharacteristics,
} from "./product-characteristics";
import { distanceExpr, offerConditions } from "./product-search-conditions";

export interface ProductDetailParams {
	/** Il negozio da cui arriva il cliente: vince se ha il prodotto. */
	storeId?: string;
	lat?: number;
	lng?: number;
}

export interface ProductDetail {
	id: string;
	name: string;
	description: string | null;
	price: string;
	discountedPrice: string | null;
	discountPercent: number | null;
	brandName: string | null;
	category: {
		id: string;
		name: string;
		macroCategory: { id: string; name: string };
	} | null;
	images: { id: string; url: string; position: number }[];
	offer: {
		storeProductId: string;
		stock: number;
		distance: number | null;
		store: {
			id: string;
			name: string;
			municipality: { id: string; name: string; provinceAcronym: string };
		};
	};
	otherStoreCount: number;
	/** Il cliente chiedeva un negozio che non ce l'ha (più): ne è stato agganciato un altro. */
	requestedStoreUnavailable: boolean;
	characteristics: CustomerCharacteristic[];
}

/**
 * La scheda prodotto del cliente. Visibile solo se il prodotto è attivo e
 * almeno un negozio pubblicamente visibile lo ha con giacenza: lo stesso
 * insieme della ricerca, perché le condizioni sul negozio sono le stesse
 * (`offerConditions`, senza raggio e senza «aperto ora»).
 *
 * Il negozio agganciato segue la regola del laterale di `searchProducts` —
 * il più vicino, e senza origine il primo per nome — con davanti la
 * preferenza per il negozio da cui il cliente arriva. `count(*) OVER ()` si
 * valuta prima del LIMIT: conta tutti i negozi idonei in una query sola.
 */
export async function getProductDetail(
	productId: string,
	params: ProductDetailParams,
): Promise<ProductDetail> {
	const distance = distanceExpr(params.lat, params.lng);
	const preferred = params.storeId
		? sql`(${store.id} = ${params.storeId}) DESC,`
		: sql``;

	const [row] = await db
		.select({
			id: product.id,
			name: product.name,
			description: product.description,
			price: product.price,
			productCategoryId: product.productCategoryId,
			brandName: brand.name,
			categoryId: productCategory.id,
			categoryName: productCategory.name,
			macroId: productMacroCategory.id,
			macroName: productMacroCategory.name,
			storeProductId: storeProduct.id,
			stock: storeProduct.stock,
			storeId: store.id,
			storeName: store.name,
			municipalityId: municipality.id,
			municipalityName: municipality.name,
			provinceAcronym: province.acronym,
			distance: sql<number | null>`${distance}`,
			matchCount: sql<number>`(count(*) OVER ())::int`,
		})
		.from(product)
		.innerJoin(storeProduct, eq(storeProduct.productId, product.id))
		.innerJoin(store, eq(store.id, storeProduct.storeId))
		.innerJoin(municipality, eq(municipality.id, store.municipalityId))
		.innerJoin(province, eq(province.id, municipality.provinceId))
		.leftJoin(brand, eq(brand.id, product.brandId))
		.leftJoin(
			productCategory,
			eq(productCategory.id, product.productCategoryId),
		)
		.leftJoin(
			productMacroCategory,
			eq(productMacroCategory.id, productCategory.macroCategoryId),
		)
		.where(
			and(
				eq(product.id, productId),
				sql`${product.status} = 'active'`,
				// Senza `radius` il filtro geografico non si applica: lat/lng
				// servono solo a ordinare.
				...offerConditions({ lat: params.lat, lng: params.lng }, null),
			),
		)
		.orderBy(
			sql`${preferred} ${distance} ASC NULLS LAST, ${store.name} ASC, ${store.id} ASC`,
		)
		.limit(1);

	if (!row) throw new ServiceError(404, "Prodotto non trovato");

	const [images, discounts, characteristics] = await Promise.all([
		db
			.select({
				id: productImage.id,
				url: productImage.url,
				position: productImage.position,
			})
			.from(productImage)
			.where(eq(productImage.productId, row.id))
			.orderBy(asc(productImage.position)),
		getBestActiveDiscounts([row.id]),
		listCustomerCharacteristics(row.id, row.productCategoryId),
	]);
	const discount = discounts.get(row.id);

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		price: row.price,
		discountedPrice: discount?.discountedPrice ?? null,
		discountPercent: discount?.percent ?? null,
		brandName: row.brandName,
		category:
			row.categoryId && row.categoryName && row.macroId && row.macroName
				? {
						id: row.categoryId,
						name: row.categoryName,
						macroCategory: { id: row.macroId, name: row.macroName },
					}
				: null,
		images,
		offer: {
			storeProductId: row.storeProductId,
			stock: row.stock,
			distance:
				row.distance === null || row.distance === undefined
					? null
					: Number(row.distance),
			store: {
				id: row.storeId,
				name: row.storeName,
				municipality: {
					id: row.municipalityId,
					name: row.municipalityName,
					provinceAcronym: row.provinceAcronym,
				},
			},
		},
		otherStoreCount: row.matchCount - 1,
		requestedStoreUnavailable:
			params.storeId !== undefined && row.storeId !== params.storeId,
		characteristics,
	};
}
