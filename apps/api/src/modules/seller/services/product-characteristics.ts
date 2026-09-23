import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import {
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import type { Executor } from "@/lib/characteristic-impact";
import {
	type CharacteristicDefinition,
	toCharacteristicOutputValue,
} from "@/lib/characteristic-values";
import { ServiceError } from "@/lib/errors";

export interface FormCharacteristic extends CharacteristicDefinition {
	unit: string | null;
}

/**
 * La matrice di una sotto-categoria come la usa il form del venditore: solo le
 * caratteristiche incluse, nell'ordine di sortOrder (il nome come secondo
 * criterio, perché i sortOrder possono ripetersi), con le opzioni delle liste
 * chiuse. Accetta una `tx`: il salvataggio la rilegge dentro la transazione.
 */
export async function listFormCharacteristics(
	productCategoryId: string,
	executor: Executor = db,
): Promise<FormCharacteristic[]> {
	const rows = await executor
		.select({
			id: productCharacteristic.id,
			name: productCharacteristic.name,
			dataType: productCharacteristic.dataType,
			unit: productCharacteristic.unit,
			required: productCategoryCharacteristic.required,
		})
		.from(productCategoryCharacteristic)
		.innerJoin(
			productCharacteristic,
			eq(
				productCharacteristic.id,
				productCategoryCharacteristic.characteristicId,
			),
		)
		.where(
			eq(productCategoryCharacteristic.productCategoryId, productCategoryId),
		)
		.orderBy(
			asc(productCategoryCharacteristic.sortOrder),
			asc(productCharacteristic.name),
		);

	const enumIds = rows.filter((r) => r.dataType === "enum").map((r) => r.id);
	const options =
		enumIds.length === 0
			? []
			: await executor
					.select({
						id: productCharacteristicOption.id,
						characteristicId: productCharacteristicOption.characteristicId,
						value: productCharacteristicOption.value,
					})
					.from(productCharacteristicOption)
					.where(inArray(productCharacteristicOption.characteristicId, enumIds))
					.orderBy(
						asc(productCharacteristicOption.sortOrder),
						asc(productCharacteristicOption.value),
					);

	const optionsById = new Map<string, { id: string; value: string }[]>();
	for (const o of options) {
		const list = optionsById.get(o.characteristicId) ?? [];
		list.push({ id: o.id, value: o.value });
		optionsById.set(o.characteristicId, list);
	}
	return rows.map((r) => ({ ...r, options: optionsById.get(r.id) ?? [] }));
}

export async function getFormCharacteristics(productCategoryId: string) {
	const found = await db.query.productCategory.findFirst({
		where: eq(productCategory.id, productCategoryId),
		columns: { id: true },
	});
	if (!found) throw new ServiceError(404, "Sotto-categoria non trovata");
	return listFormCharacteristics(productCategoryId);
}

/** I valori salvati di un prodotto, con il nome della caratteristica. */
export async function listProductCharacteristicValues(
	productId: string,
	executor: Executor = db,
) {
	const rows = await executor
		.select({
			characteristicId: productCharacteristicValue.characteristicId,
			name: productCharacteristic.name,
			dataType: productCharacteristicValue.dataType,
			valueText: productCharacteristicValue.valueText,
			valueNumber: productCharacteristicValue.valueNumber,
			valueBoolean: productCharacteristicValue.valueBoolean,
			optionId: productCharacteristicValue.optionId,
		})
		.from(productCharacteristicValue)
		.innerJoin(
			productCharacteristic,
			eq(productCharacteristic.id, productCharacteristicValue.characteristicId),
		)
		.where(eq(productCharacteristicValue.productId, productId))
		.orderBy(asc(productCharacteristic.name));

	return rows.map(({ characteristicId, name, ...stored }) => ({
		characteristicId,
		name,
		value: toCharacteristicOutputValue(stored),
	}));
}
