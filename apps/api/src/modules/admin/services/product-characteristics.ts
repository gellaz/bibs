import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
	type CharacteristicDataType,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import {
	assertImpactConfirmed,
	countValuesByCharacteristic,
	countValuesByOption,
	sumCounts,
} from "./characteristic-impact";
import { type ListByNameParams, listByNamePaged } from "./list-by-name-paged";

export interface CharacteristicOptionInput {
	// Presente per un'opzione esistente: tenere l'id è ciò che permette di
	// rinominare un'opzione senza perdere i valori che la usano.
	id?: string;
	value: string;
}

/**
 * Le regole di forma di una caratteristica, le stesse dell'import CSV e con
 * gli stessi messaggi: unità solo per i numeri, opzioni solo (e almeno una)
 * per le liste chiuse, nessuna opzione ripetuta. Le opzioni vuote si scartano.
 */
export function normalizeDefinition(p: {
	dataType: CharacteristicDataType;
	unit?: string | null;
	options?: CharacteristicOptionInput[];
}): { unit: string | null; options: CharacteristicOptionInput[] } {
	const unit = p.unit?.trim() || null;
	if (unit && p.dataType !== "number") {
		throw new ServiceError(
			400,
			`L'unità di misura ha senso solo per il tipo "number"`,
		);
	}

	const options = (p.options ?? [])
		.map((o) => ({ ...o, value: o.value.trim() }))
		.filter((o) => o.value.length > 0);
	if (options.length > 0 && p.dataType !== "enum") {
		throw new ServiceError(
			400,
			`Le opzioni hanno senso solo per il tipo "enum"`,
		);
	}
	if (p.dataType === "enum" && options.length === 0) {
		throw new ServiceError(400, `Il tipo "enum" richiede almeno un'opzione`);
	}

	const seen = new Set<string>();
	for (const o of options) {
		if (seen.has(o.value)) {
			throw new ServiceError(400, `Opzione ripetuta: "${o.value}"`);
		}
		seen.add(o.value);
	}

	return { unit, options };
}

interface ListProductCharacteristicsParams extends ListByNameParams {
	dataType?: CharacteristicDataType;
}

export async function listProductCharacteristics(
	params: ListProductCharacteristicsParams,
) {
	const page = await listByNamePaged(
		productCharacteristic,
		params,
		(opts) =>
			db.query.productCharacteristic.findMany({
				...opts,
				with: {
					options: { orderBy: (o, { asc }) => [asc(o.sortOrder)] },
				},
			}),
		[
			params.dataType
				? eq(productCharacteristic.dataType, params.dataType)
				: undefined,
		],
	);

	// Due query raggruppate sulla pagina invece di una sottoquery per riga: i
	// numeri servono all'interfaccia per dire, prima di chiedere conferma,
	// quanti prodotti perderebbero un valore.
	const [valueCounts, optionCounts] = await Promise.all([
		countValuesByCharacteristic(page.data.map((c) => c.id)),
		countValuesByOption(page.data.flatMap((c) => c.options.map((o) => o.id))),
	]);

	return {
		pagination: page.pagination,
		data: page.data.map((c) => ({
			id: c.id,
			name: c.name,
			dataType: c.dataType,
			unit: c.unit,
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
			valueCount: valueCounts.get(c.id) ?? 0,
			options: c.options.map((o) => ({
				id: o.id,
				value: o.value,
				sortOrder: o.sortOrder,
				valueCount: optionCounts.get(o.id) ?? 0,
			})),
		})),
	};
}

interface CreateProductCharacteristicParams {
	name: string;
	dataType: CharacteristicDataType;
	unit?: string | null;
	options?: CharacteristicOptionInput[];
}

export async function createProductCharacteristic(
	params: CreateProductCharacteristicParams,
) {
	const { unit, options } = normalizeDefinition(params);

	return db.transaction(async (tx) => {
		const [created] = await tx
			.insert(productCharacteristic)
			.values({ name: params.name.trim(), dataType: params.dataType, unit })
			.returning();

		if (options.length > 0) {
			await tx.insert(productCharacteristicOption).values(
				options.map((o, sortOrder) => ({
					characteristicId: created.id,
					value: o.value,
					sortOrder,
				})),
			);
		}

		return created;
	});
}

export async function deleteProductCharacteristic(
	characteristicId: string,
	confirmAffected: number,
) {
	return db.transaction(async (tx) => {
		const affected =
			(await countValuesByCharacteristic([characteristicId], tx)).get(
				characteristicId,
			) ?? 0;
		assertImpactConfirmed(affected, confirmAffected);

		// Prima i valori, poi la definizione (D10): le chiavi esterne dei valori
		// sono RESTRICT apposta. Opzioni e righe di matrice vanno in CASCADE.
		await tx
			.delete(productCharacteristicValue)
			.where(eq(productCharacteristicValue.characteristicId, characteristicId));

		const [deleted] = await tx
			.delete(productCharacteristic)
			.where(eq(productCharacteristic.id, characteristicId))
			.returning();

		if (!deleted) throw new ServiceError(404, "Caratteristica non trovata");
		return { deleted, deletedValues: affected };
	});
}

interface UpdateProductCharacteristicParams {
	characteristicId: string;
	name?: string;
	dataType?: CharacteristicDataType;
	unit?: string | null;
	options?: CharacteristicOptionInput[];
	confirmAffected: number;
}

/**
 * Modifica una voce del dizionario. Le opzioni si sincronizzano per id: una
 * che arriva con il suo id resta la stessa riga anche se cambia testo, quindi
 * i valori che la usano sopravvivono. Due atti cancellano valori (D10) e
 * passano solo se confermati: rimuovere un'opzione in uso e cambiare il tipo.
 */
export async function updateProductCharacteristic(
	params: UpdateProductCharacteristicParams,
) {
	const { characteristicId } = params;

	return db.transaction(async (tx) => {
		const current = await tx.query.productCharacteristic.findFirst({
			where: eq(productCharacteristic.id, characteristicId),
			with: { options: true },
		});
		if (!current) throw new ServiceError(404, "Caratteristica non trovata");

		const dataType = params.dataType ?? current.dataType;
		const typeChanged = dataType !== current.dataType;

		// Campi omessi = invariati. Ma un cambio di tipo non eredita né l'unità
		// né le opzioni del tipo precedente.
		const proposedOptions =
			params.options ??
			(typeChanged
				? []
				: current.options.map((o) => ({ id: o.id, value: o.value })));
		const proposedUnit =
			params.unit !== undefined
				? params.unit
				: typeChanged
					? null
					: current.unit;

		const { unit, options } = normalizeDefinition({
			dataType,
			unit: proposedUnit,
			options: proposedOptions,
		});

		const currentOptionIds = new Set(current.options.map((o) => o.id));
		for (const o of options) {
			if (o.id && !currentOptionIds.has(o.id)) {
				throw new ServiceError(
					400,
					`Opzione sconosciuta per "${current.name}"`,
				);
			}
		}

		const keptIds = new Set(options.flatMap((o) => (o.id ? [o.id] : [])));
		const removedOptionIds = current.options
			.filter((o) => !keptIds.has(o.id))
			.map((o) => o.id);

		const affected = typeChanged
			? ((await countValuesByCharacteristic([characteristicId], tx)).get(
					characteristicId,
				) ?? 0)
			: sumCounts(await countValuesByOption(removedOptionIds, tx));
		assertImpactConfirmed(affected, params.confirmAffected);

		// Prima i valori (D10), poi le opzioni: option_id è RESTRICT.
		if (typeChanged) {
			await tx
				.delete(productCharacteristicValue)
				.where(
					eq(productCharacteristicValue.characteristicId, characteristicId),
				);
		} else if (removedOptionIds.length > 0) {
			await tx
				.delete(productCharacteristicValue)
				.where(inArray(productCharacteristicValue.optionId, removedOptionIds));
		}
		if (removedOptionIds.length > 0) {
			await tx
				.delete(productCharacteristicOption)
				.where(inArray(productCharacteristicOption.id, removedOptionIds));
		}

		// La chiave esterna composta (id, data_type) dei valori accetta il nuovo
		// tipo solo perché i valori del tipo vecchio sono già stati cancellati.
		const [updated] = await tx
			.update(productCharacteristic)
			.set({
				...(params.name !== undefined ? { name: params.name.trim() } : {}),
				dataType,
				unit,
			})
			.where(eq(productCharacteristic.id, characteristicId))
			.returning();

		// Opzioni tenute in due passi: prima un valore provvisorio univoco per
		// quelle che cambiano testo, poi quello definitivo. Senza, uno scambio
		// (Rosso↔Blu) violerebbe UNIQUE (characteristic_id, value) a metà strada.
		const valueById = new Map(current.options.map((o) => [o.id, o.value]));
		const kept = options.flatMap((o, sortOrder) =>
			o.id ? [{ id: o.id, value: o.value, sortOrder }] : [],
		);
		for (const k of kept) {
			if (valueById.get(k.id) === k.value) continue;
			await tx
				.update(productCharacteristicOption)
				// Postgres rifiuta il byte NUL nei testi: il prefisso basta a non
				// collidere, perché nessun valore reale inizia così.
				.set({ value: `__rinomina__${k.id}` })
				.where(eq(productCharacteristicOption.id, k.id));
		}
		for (const k of kept) {
			await tx
				.update(productCharacteristicOption)
				.set({ value: k.value, sortOrder: k.sortOrder })
				.where(eq(productCharacteristicOption.id, k.id));
		}

		const inserted = options.flatMap((o, sortOrder) =>
			o.id ? [] : [{ characteristicId, value: o.value, sortOrder }],
		);
		if (inserted.length > 0) {
			await tx.insert(productCharacteristicOption).values(inserted);
		}

		return { updated, deletedValues: affected };
	});
}
