import { count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
	CHARACTERISTIC_DATA_TYPES,
	type CharacteristicDataType,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { ServiceError } from "@/lib/errors";
import { parseCsv } from "@/lib/utils/csv";

const CHARACTERISTIC_HEADERS = ["name", "data_type", "unit", "options"];

function assertHeaders(actual: string[], expected: string[]) {
	for (const h of expected) {
		if (!actual.includes(h)) {
			throw new ServiceError(
				400,
				`Missing CSV header: "${h}". Expected headers: ${expected.join(", ")}`,
			);
		}
	}
}

interface ImportError {
	row: number;
	message: string;
}

export interface CharacteristicImportResult {
	created: number;
	updated: number;
	failed: number;
	errors: ImportError[];
}

interface ParsedRow {
	rowNum: number;
	name: string;
	dataType: CharacteristicDataType;
	unit: string | null;
	options: string[];
}

interface OptionSyncPlan {
	// Opzioni esistenti che restano: stesso id, nuovo sortOrder. Preservare
	// l'id e' il punto — un valore prodotto che referenzia quell'opzione
	// resta valido, e un CSV con la stessa lista diventa un no-op pulito.
	keep: { id: string; sortOrder: number }[];
	insert: { value: string; sortOrder: number }[];
	deleteIds: string[];
}

interface PlannedUpdate extends ParsedRow {
	id: string;
	optionSync: OptionSyncPlan;
}

/**
 * Importa il dizionario delle caratteristiche prodotto da CSV.
 *
 * A differenza delle importazioni di categorie, questa e' **in aggiornamento**:
 * una riga il cui `name` esiste gia' aggiorna tipo, unita' e opzioni invece di
 * essere saltata, cosi' un errore di tipizzazione si corregge dal CSV senza
 * passare da una UI amministrativa che non esiste ancora.
 */
export async function importCharacteristicsFromCsv(
	csvText: string,
): Promise<CharacteristicImportResult> {
	const { headers, rows } = parseCsv(csvText);
	assertHeaders(headers, CHARACTERISTIC_HEADERS);

	if (rows.length === 0) {
		throw new ServiceError(400, "CSV file contains no data rows");
	}

	const nameIdx = headers.indexOf("name");
	const dataTypeIdx = headers.indexOf("data_type");
	const unitIdx = headers.indexOf("unit");
	const optionsIdx = headers.indexOf("options");

	const errors: ImportError[] = [];
	// Map, non array: una riga che ricorre nello stesso CSV con lo stesso nome
	// vince l'ultima, cosi' come in aggiornamento vince l'ultimo import.
	const parsedByName = new Map<string, ParsedRow>();

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2; // 1-indicizzato + intestazione

		const name = (row[nameIdx] ?? "").trim();
		const dataTypeRaw = (row[dataTypeIdx] ?? "").trim();
		const unitRaw = (row[unitIdx] ?? "").trim();
		const optionsRaw = (row[optionsIdx] ?? "").trim();

		if (!name) {
			errors.push({ row: rowNum, message: "Nome caratteristica mancante" });
			continue;
		}

		if (
			!CHARACTERISTIC_DATA_TYPES.includes(dataTypeRaw as CharacteristicDataType)
		) {
			errors.push({
				row: rowNum,
				message: `Tipo dato non valido: "${dataTypeRaw}". Valori ammessi: ${CHARACTERISTIC_DATA_TYPES.join(", ")}.`,
			});
			continue;
		}
		const dataType = dataTypeRaw as CharacteristicDataType;

		if (unitRaw && dataType !== "number") {
			errors.push({
				row: rowNum,
				message: `L'unità di misura ha senso solo per il tipo "number"`,
			});
			continue;
		}

		if (optionsRaw && dataType !== "enum") {
			errors.push({
				row: rowNum,
				message: `Le opzioni hanno senso solo per il tipo "enum"`,
			});
			continue;
		}

		const options = optionsRaw
			? optionsRaw
					.split("|")
					.map((option) => option.trim())
					.filter((option) => option.length > 0)
			: [];

		if (dataType === "enum" && options.length === 0) {
			errors.push({
				row: rowNum,
				message: `Il tipo "enum" richiede almeno un'opzione`,
			});
			continue;
		}

		parsedByName.set(name, {
			rowNum,
			name,
			dataType,
			unit: unitRaw || null,
			options,
		});
	}

	if (parsedByName.size === 0) {
		return { created: 0, updated: 0, failed: errors.length, errors };
	}

	const names = Array.from(parsedByName.keys());
	const existingCharacteristics = await db
		.select({
			id: productCharacteristic.id,
			name: productCharacteristic.name,
			dataType: productCharacteristic.dataType,
		})
		.from(productCharacteristic)
		.where(inArray(productCharacteristic.name, names));

	const existingByName = new Map(
		existingCharacteristics.map((c) => [c.name, c]),
	);

	const toCreate: ParsedRow[] = [];
	const toUpdate: PlannedUpdate[] = [];

	for (const parsed of parsedByName.values()) {
		const current = existingByName.get(parsed.name);
		if (!current) {
			toCreate.push(parsed);
			continue;
		}

		// Il cambio di tipo si controlla PRIMA dell'UPDATE, contando i valori
		// gia' registrati: la chiave esterna composta (id, data_type) lo
		// rifiuterebbe comunque, ma con un errore Postgres inutilizzabile
		// dall'amministratore.
		if (current.dataType !== parsed.dataType) {
			const [{ valueCount }] = await db
				.select({ valueCount: count() })
				.from(productCharacteristicValue)
				.where(eq(productCharacteristicValue.characteristicId, current.id));

			if (valueCount > 0) {
				errors.push({
					row: parsed.rowNum,
					message: `Impossibile cambiare il tipo di "${parsed.name}": ${valueCount} valor${valueCount === 1 ? "e" : "i"} prodotto già registrat${valueCount === 1 ? "o" : "i"} con il tipo attuale.`,
				});
				continue;
			}
		}

		// Le opzioni si sincronizzano per valore, non si sostituiscono per
		// intero: un'opzione il cui valore compare sia nell'elenco esistente
		// che in quello nuovo mantiene id (e sortOrder aggiornato), cosi' un
		// valore prodotto che la referenzia resta valido e ri-importare lo
		// stesso elenco e' un no-op. Solo le opzioni assenti dal nuovo elenco
		// vengono cancellate — ed e' solo su QUELLE che si conta prima il
		// riferimento, per intercettare il RESTRICT con un errore leggibile
		// invece di lasciarlo scattare sul DELETE.
		const existingOptions = await db
			.select({
				id: productCharacteristicOption.id,
				value: productCharacteristicOption.value,
			})
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.characteristicId, current.id));

		const newValues = new Set(parsed.options);
		const toDeleteOptions = existingOptions.filter(
			(o) => !newValues.has(o.value),
		);

		if (toDeleteOptions.length > 0) {
			const referencedRows = await db
				.select({
					optionId: productCharacteristicValue.optionId,
					cnt: count(),
				})
				.from(productCharacteristicValue)
				.where(
					inArray(
						productCharacteristicValue.optionId,
						toDeleteOptions.map((o) => o.id),
					),
				)
				.groupBy(productCharacteristicValue.optionId);

			if (referencedRows.length > 0) {
				const valueById = new Map(existingOptions.map((o) => [o.id, o.value]));
				const stillUsedValues = referencedRows.map(
					(r) => valueById.get(r.optionId as string) ?? "?",
				);
				const totalReferenced = referencedRows.reduce(
					(sum, r) => sum + r.cnt,
					0,
				);
				const optionsPhrase =
					stillUsedValues.length === 1
						? `all'opzione ${stillUsedValues[0]}`
						: `alle opzioni ${stillUsedValues.join(", ")}`;

				errors.push({
					row: parsed.rowNum,
					message: `Impossibile rimuovere le opzioni di "${parsed.name}": ${totalReferenced} valor${totalReferenced === 1 ? "e" : "i"} prodotto ${totalReferenced === 1 ? "è ancora collegato" : "sono ancora collegati"} ${optionsPhrase}.`,
				});
				continue;
			}
		}

		const existingIdByValue = new Map(
			existingOptions.map((o) => [o.value, o.id]),
		);
		const keep: OptionSyncPlan["keep"] = [];
		const insert: OptionSyncPlan["insert"] = [];
		parsed.options.forEach((value, sortOrder) => {
			const existingId = existingIdByValue.get(value);
			if (existingId) {
				keep.push({ id: existingId, sortOrder });
			} else {
				insert.push({ value, sortOrder });
			}
		});

		toUpdate.push({
			...parsed,
			id: current.id,
			optionSync: {
				keep,
				insert,
				deleteIds: toDeleteOptions.map((o) => o.id),
			},
		});
	}

	let created = 0;
	let updated = 0;

	if (toCreate.length > 0 || toUpdate.length > 0) {
		await db.transaction(async (tx) => {
			if (toCreate.length > 0) {
				const inserted = await tx
					.insert(productCharacteristic)
					.values(
						toCreate.map((r) => ({
							name: r.name,
							dataType: r.dataType,
							unit: r.unit,
						})),
					)
					.returning({
						id: productCharacteristic.id,
						name: productCharacteristic.name,
					});

				created += inserted.length;

				const idByName = new Map(inserted.map((c) => [c.name, c.id]));
				const optionValues: {
					characteristicId: string;
					value: string;
					sortOrder: number;
				}[] = [];
				for (const r of toCreate) {
					if (r.dataType !== "enum") continue;
					const characteristicId = idByName.get(r.name);
					if (!characteristicId) {
						throw new ServiceError(
							500,
							`Characteristic "${r.name}" lookup failed after insert`,
						);
					}
					r.options.forEach((value, sortOrder) => {
						optionValues.push({ characteristicId, value, sortOrder });
					});
				}
				if (optionValues.length > 0) {
					await tx.insert(productCharacteristicOption).values(optionValues);
				}
			}

			for (const r of toUpdate) {
				await tx
					.update(productCharacteristic)
					.set({ dataType: r.dataType, unit: r.unit })
					.where(eq(productCharacteristic.id, r.id));

				if (r.optionSync.deleteIds.length > 0) {
					await tx
						.delete(productCharacteristicOption)
						.where(
							inArray(productCharacteristicOption.id, r.optionSync.deleteIds),
						);
				}

				for (const k of r.optionSync.keep) {
					await tx
						.update(productCharacteristicOption)
						.set({ sortOrder: k.sortOrder })
						.where(eq(productCharacteristicOption.id, k.id));
				}

				if (r.optionSync.insert.length > 0) {
					await tx.insert(productCharacteristicOption).values(
						r.optionSync.insert.map((o) => ({
							characteristicId: r.id,
							value: o.value,
							sortOrder: o.sortOrder,
						})),
					);
				}

				updated++;
			}
		});
	}

	return { created, updated, failed: errors.length, errors };
}
