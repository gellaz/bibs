import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	type CharacteristicDataType,
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { toCharacteristicDisplayValue } from "@/lib/characteristic-values";

export interface CustomerCharacteristic {
	characteristicId: string;
	name: string;
	dataType: CharacteristicDataType;
	unit: string | null;
	value: string | number | boolean;
}

/**
 * Le caratteristiche valorizzate di un prodotto, come le legge il cliente:
 * nell'ordine della matrice (sortOrder, poi nome), con l'etichetta delle
 * opzioni. Il join sulla matrice della sotto-categoria corrente dà l'ordine e,
 * per giunta, scarta un valore fuori matrice che D10 non dovrebbe mai lasciare.
 * Le obbligatorie non contano: una non compilata semplicemente non c'è.
 */
export async function listCustomerCharacteristics(
	productId: string,
	productCategoryId: string | null,
): Promise<CustomerCharacteristic[]> {
	if (!productCategoryId) return [];

	const rows = await db
		.select({
			characteristicId: productCharacteristicValue.characteristicId,
			name: productCharacteristic.name,
			unit: productCharacteristic.unit,
			dataType: productCharacteristicValue.dataType,
			valueText: productCharacteristicValue.valueText,
			valueNumber: productCharacteristicValue.valueNumber,
			valueBoolean: productCharacteristicValue.valueBoolean,
			optionId: productCharacteristicValue.optionId,
			optionValue: productCharacteristicOption.value,
		})
		.from(productCharacteristicValue)
		.innerJoin(
			productCharacteristic,
			eq(productCharacteristic.id, productCharacteristicValue.characteristicId),
		)
		.innerJoin(
			productCategoryCharacteristic,
			and(
				eq(
					productCategoryCharacteristic.characteristicId,
					productCharacteristicValue.characteristicId,
				),
				eq(productCategoryCharacteristic.productCategoryId, productCategoryId),
			),
		)
		.leftJoin(
			productCharacteristicOption,
			eq(productCharacteristicOption.id, productCharacteristicValue.optionId),
		)
		.where(eq(productCharacteristicValue.productId, productId))
		.orderBy(
			asc(productCategoryCharacteristic.sortOrder),
			asc(productCharacteristic.name),
		);

	return rows.flatMap(
		({ characteristicId, name, unit, optionValue, ...stored }) => {
			const value = toCharacteristicDisplayValue(stored, optionValue);
			if (value === null) return [];
			return [
				{ characteristicId, name, dataType: stored.dataType, unit, value },
			];
		},
	);
}
