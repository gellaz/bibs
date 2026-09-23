import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
	type CharacteristicValueInput,
	filledAfter,
	missingRequired,
	toCharacteristicOutputValue,
	validateCharacteristicValues,
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

/**
 * - `create`: il prodotto nasce dal form, ogni obbligatoria va compilata.
 * - `stay`: resta nella sua sotto-categoria; un'obbligatoria mai compilata è
 *   tollerata, una già compilata non si svuota.
 * - `change`: cambia sotto-categoria; come `create`, più la pulizia di D10.
 * (Decisione P1 del piano PR 4.)
 */
export type SaveMode = "create" | "stay" | "change";

interface SaveProductCharacteristicsParams {
	productId: string;
	productCategoryId: string | null;
	inputs: CharacteristicValueInput[];
	mode: SaveMode;
	/** Solo per `change`: i valori persi che l'interfaccia ha mostrato. */
	confirmAffected: number;
}

/**
 * Scrive i valori delle caratteristiche di un prodotto dentro la transazione
 * di chi chiama. Una voce con valore aggiorna, una voce vuota cancella, una
 * caratteristica assente dalla lista resta com'è. Ogni errore lancia, e la
 * transazione dell'intero salvataggio va in rollback.
 */
export async function saveProductCharacteristics(
	tx: Executor,
	params: SaveProductCharacteristicsParams,
) {
	const { productId, productCategoryId, inputs, mode } = params;
	if (mode === "stay" && inputs.length === 0) return;

	const definitions = productCategoryId
		? await listFormCharacteristics(productCategoryId, tx)
		: [];

	const existing = await tx
		.select({ id: productCharacteristicValue.characteristicId })
		.from(productCharacteristicValue)
		.where(eq(productCharacteristicValue.productId, productId));
	const before = new Set(existing.map((r) => r.id));

	const validated = validateCharacteristicValues(definitions, inputs);
	if (validated.errors.length > 0) {
		throw new ServiceError(400, validated.errors.join("; "));
	}

	const entering = mode !== "stay";
	const missing = missingRequired({
		definitions,
		before,
		after: filledAfter(before, validated),
		entering,
	});
	if (missing.length > 0) {
		throw new ServiceError(
			400,
			entering
				? `Compila le caratteristiche obbligatorie: ${missing.join(", ")}`
				: `Non puoi svuotare una caratteristica obbligatoria: ${missing.join(", ")}`,
		);
	}

	if (validated.clears.length > 0) {
		await tx
			.delete(productCharacteristicValue)
			.where(
				and(
					eq(productCharacteristicValue.productId, productId),
					inArray(
						productCharacteristicValue.characteristicId,
						validated.clears,
					),
				),
			);
	}
	if (validated.upserts.length > 0) {
		await tx
			.insert(productCharacteristicValue)
			.values(validated.upserts.map((r) => ({ productId, ...r })))
			// Tutte le colonne, anche quelle a null: il CHECK vuole valorizzata
			// solo la colonna del tipo.
			.onConflictDoUpdate({
				target: [
					productCharacteristicValue.productId,
					productCharacteristicValue.characteristicId,
				],
				set: {
					dataType: sql`excluded.data_type`,
					valueText: sql`excluded.value_text`,
					valueNumber: sql`excluded.value_number`,
					valueBoolean: sql`excluded.value_boolean`,
					optionId: sql`excluded.option_id`,
				},
			});
	}
}
