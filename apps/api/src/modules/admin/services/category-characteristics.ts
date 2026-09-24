import {
	and,
	asc,
	count,
	eq,
	getTableColumns,
	inArray,
	max,
	sql,
} from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { product } from "@/db/schemas/product";
import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { assertImpactConfirmed } from "@/lib/characteristic-impact";
import { ServiceError } from "@/lib/errors";
import { type ListByNameParams, listByNamePaged } from "./list-by-name-paged";

interface ListAdminProductCategoriesParams extends ListByNameParams {
	macroCategoryId?: string;
}

/**
 * Le sotto-categorie come le vede l'admin: le stesse del listato pubblico più
 * quante caratteristiche ha ciascuna nella matrice.
 */
export async function listAdminProductCategories(
	params: ListAdminProductCategoriesParams,
) {
	return listByNamePaged(
		productCategory,
		params,
		({ where, orderBy, limit, offset }) =>
			db
				.select({
					...getTableColumns(productCategory),
					macroCategory: getTableColumns(productMacroCategory),
					// Sottoquery correlata in un campo SELECT: le Column interpolate qui
					// escono SENZA qualificazione di tabella, e `${productCategory.id}`
					// diventerebbe un "id" nudo risolto sulla tabella interna. Alias
					// interno e riferimento letterale alla tabella esterna.
					characteristicCount: sql<number>`(
						SELECT count(*)::int
						FROM ${productCategoryCharacteristic} pcc
						WHERE pcc.product_category_id = product_categories.id
					)`,
				})
				.from(productCategory)
				.innerJoin(
					productMacroCategory,
					eq(productCategory.macroCategoryId, productMacroCategory.id),
				)
				.where(where)
				.orderBy(orderBy)
				.limit(limit)
				.offset(offset),
		[
			params.macroCategoryId
				? eq(productCategory.macroCategoryId, params.macroCategoryId)
				: undefined,
		],
	);
}

async function assertCategoryExists(productCategoryId: string) {
	const found = await db.query.productCategory.findFirst({
		where: eq(productCategory.id, productCategoryId),
		columns: { id: true },
	});
	if (!found) throw new ServiceError(404, "Sotto-categoria non trovata");
}

/**
 * Tutto il dizionario, con lo stato della riga per questa sotto-categoria:
 * inclusa o no, obbligatoria o no, e quanti suoi prodotti hanno già un valore
 * (il numero che la conferma di rimozione deve mostrare).
 */
export async function listCategoryCharacteristics(productCategoryId: string) {
	await assertCategoryExists(productCategoryId);

	const [rows, counts] = await Promise.all([
		db
			.select({
				id: productCharacteristic.id,
				name: productCharacteristic.name,
				dataType: productCharacteristic.dataType,
				unit: productCharacteristic.unit,
				linkSortOrder: productCategoryCharacteristic.sortOrder,
				required: productCategoryCharacteristic.required,
			})
			.from(productCharacteristic)
			.leftJoin(
				productCategoryCharacteristic,
				and(
					eq(
						productCategoryCharacteristic.characteristicId,
						productCharacteristic.id,
					),
					eq(
						productCategoryCharacteristic.productCategoryId,
						productCategoryId,
					),
				),
			)
			.orderBy(asc(productCharacteristic.name)),
		db
			.select({
				id: productCharacteristicValue.characteristicId,
				cnt: count(),
			})
			.from(productCharacteristicValue)
			.innerJoin(product, eq(product.id, productCharacteristicValue.productId))
			.where(eq(product.productCategoryId, productCategoryId))
			.groupBy(productCharacteristicValue.characteristicId),
	]);

	const countById = new Map(counts.map((c) => [c.id, c.cnt]));
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		dataType: r.dataType,
		unit: r.unit,
		included: r.linkSortOrder !== null,
		required: r.required ?? false,
		valueCount: countById.get(r.id) ?? 0,
	}));
}

export async function setCategoryCharacteristic(params: {
	productCategoryId: string;
	characteristicId: string;
	required: boolean;
}) {
	const { productCategoryId, characteristicId, required } = params;
	await assertCategoryExists(productCategoryId);
	// Senza questo controllo un id inesistente arriverebbe alla chiave esterna,
	// che il gestore errori globale non traduce: un 500 invece di un 404.
	const characteristic = await db.query.productCharacteristic.findFirst({
		where: eq(productCharacteristic.id, characteristicId),
		columns: { id: true },
	});
	if (!characteristic)
		throw new ServiceError(404, "Caratteristica non trovata");

	return db.transaction(async (tx) => {
		const [{ last }] = await tx
			.select({ last: max(productCategoryCharacteristic.sortOrder) })
			.from(productCategoryCharacteristic)
			.where(
				eq(productCategoryCharacteristic.productCategoryId, productCategoryId),
			);

		const [link] = await tx
			.insert(productCategoryCharacteristic)
			.values({
				productCategoryId,
				characteristicId,
				required,
				sortOrder: (last ?? -1) + 1,
			})
			// Già inclusa: cambia solo l'obbligatorietà, la posizione resta.
			.onConflictDoUpdate({
				target: [
					productCategoryCharacteristic.productCategoryId,
					productCategoryCharacteristic.characteristicId,
				],
				set: { required },
			})
			.returning();

		return link;
	});
}

export async function removeCategoryCharacteristic(params: {
	productCategoryId: string;
	characteristicId: string;
	confirmAffected: number;
}) {
	const { productCategoryId, characteristicId } = params;

	return db.transaction(async (tx) => {
		// Prima i valori dei prodotti di QUESTA sotto-categoria (D10): la stessa
		// caratteristica resta valida, con i suoi valori, sulle altre. Il
		// conteggio di conferma è sulle righe EFFETTIVAMENTE cancellate: sotto
		// READ COMMITTED un valore scritto tra un conteggio separato e questo
		// DELETE verrebbe cancellato senza essere mai stato confermato. Se supera
		// `confirmAffected` l'assert lancia e la transazione va in rollback,
		// quindi il DELETE non ha comunque effetto.
		const deletedValueRows = await tx
			.delete(productCharacteristicValue)
			.where(
				and(
					eq(productCharacteristicValue.characteristicId, characteristicId),
					inArray(
						productCharacteristicValue.productId,
						tx
							.select({ id: product.id })
							.from(product)
							.where(eq(product.productCategoryId, productCategoryId)),
					),
				),
			)
			.returning({ productId: productCharacteristicValue.productId });
		assertImpactConfirmed(deletedValueRows.length, params.confirmAffected);

		const [deleted] = await tx
			.delete(productCategoryCharacteristic)
			.where(
				and(
					eq(
						productCategoryCharacteristic.productCategoryId,
						productCategoryId,
					),
					eq(productCategoryCharacteristic.characteristicId, characteristicId),
				),
			)
			.returning();

		if (!deleted) {
			throw new ServiceError(
				404,
				"Caratteristica non presente in questa sotto-categoria",
			);
		}
		return { deletedValues: deletedValueRows.length };
	});
}
