import {
	and,
	count,
	type ExtractTablesWithRelations,
	eq,
	inArray,
} from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { product } from "@/db/schemas/product";
import { productCharacteristicValue } from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";

// Gli stessi conteggi servono all'import (fuori transazione, per rifiutare una
// riga) e alle modifiche admin (dentro la transazione che poi cancella, per
// confermare): accettano quindi sia `db` sia una `tx`.
export type Executor =
	| PgTransaction<any, any, ExtractTablesWithRelations<any>>
	| typeof db;

// Un prodotto ha al più un valore per caratteristica (PK product_id +
// characteristic_id), quindi ogni conteggio di valori qui sotto è anche un
// conteggio di prodotti. Le mappe contengono solo le chiavi con almeno un
// valore: chi legge usa `?? 0`.

export async function countValuesByCharacteristic(
	characteristicIds: string[],
	executor: Executor = db,
): Promise<Map<string, number>> {
	if (characteristicIds.length === 0) return new Map();
	const rows = await executor
		.select({
			id: productCharacteristicValue.characteristicId,
			cnt: count(),
		})
		.from(productCharacteristicValue)
		.where(
			inArray(productCharacteristicValue.characteristicId, characteristicIds),
		)
		.groupBy(productCharacteristicValue.characteristicId);
	return new Map(rows.map((r) => [r.id, r.cnt]));
}

export async function countValuesByOption(
	optionIds: string[],
	executor: Executor = db,
): Promise<Map<string, number>> {
	if (optionIds.length === 0) return new Map();
	const rows = await executor
		.select({ id: productCharacteristicValue.optionId, cnt: count() })
		.from(productCharacteristicValue)
		.where(inArray(productCharacteristicValue.optionId, optionIds))
		.groupBy(productCharacteristicValue.optionId);
	// `optionId` è nullable nello schema, ma il WHERE lo esclude.
	return new Map(rows.map((r) => [r.id as string, r.cnt]));
}

export async function countCategoryCharacteristicValues(
	productCategoryId: string,
	characteristicId: string,
	executor: Executor = db,
): Promise<number> {
	const [{ cnt }] = await executor
		.select({ cnt: count() })
		.from(productCharacteristicValue)
		.innerJoin(product, eq(product.id, productCharacteristicValue.productId))
		.where(
			and(
				eq(product.productCategoryId, productCategoryId),
				eq(productCharacteristicValue.characteristicId, characteristicId),
			),
		);
	return cnt;
}

export function sumCounts(counts: Map<string, number>): number {
	let total = 0;
	for (const n of counts.values()) total += n;
	return total;
}

export function productsPhrase(n: number): string {
	return `${n} prodott${n === 1 ? "o" : "i"}`;
}

/**
 * La guardia di D10: un atto che cancella valori passa solo se il client
 * dichiara di aver mostrato almeno quel numero. Il conteggio si rifà dentro la
 * transazione dell'atto, quindi una conferma data su un numero vecchio e più
 * basso viene respinta invece di cancellare più di quanto approvato.
 */
export function assertImpactConfirmed(affected: number, confirmed: number) {
	if (affected <= confirmed) return;
	if (confirmed === 0) {
		throw new ServiceError(
			409,
			`L'operazione elimina i valori già compilati su ${productsPhrase(affected)}: serve una conferma esplicita.`,
		);
	}
	throw new ServiceError(
		409,
		`I valori da eliminare sono cambiati: ora riguardano ${productsPhrase(affected)}, la conferma ne copriva ${confirmed}. Ricarica e conferma di nuovo.`,
	);
}
