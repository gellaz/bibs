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
import type { CategoryImportResult } from "./category-import";

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

interface ParsedRow {
	rowNum: number;
	name: string;
	dataType: CharacteristicDataType;
	unit: string | null;
	options: string[];
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
): Promise<CategoryImportResult> {
	const { headers, rows } = parseCsv(csvText);
	assertHeaders(headers, CHARACTERISTIC_HEADERS);

	if (rows.length === 0) {
		throw new ServiceError(400, "CSV file contains no data rows");
	}

	const nameIdx = headers.indexOf("name");
	const dataTypeIdx = headers.indexOf("data_type");
	const unitIdx = headers.indexOf("unit");
	const optionsIdx = headers.indexOf("options");

	const errors: { row: number; message: string }[] = [];
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
		return { created: 0, skipped: 0, failed: errors.length, errors };
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
	const toUpdate: (ParsedRow & { id: string })[] = [];

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
					message: `Impossibile cambiare il tipo di "${parsed.name}": ${valueCount} valore/i prodotto già registrato/i con il tipo attuale.`,
				});
				continue;
			}
		}

		// Le opzioni si sostituiscono per intero (DELETE + INSERT): un'opzione
		// ancora referenziata da un valore prodotto farebbe fallire il DELETE
		// per via del RESTRICT. Stesso principio del controllo sopra: si conta
		// prima, invece di lasciar scattare il vincolo.
		const existingOptions = await db
			.select({ id: productCharacteristicOption.id })
			.from(productCharacteristicOption)
			.where(eq(productCharacteristicOption.characteristicId, current.id));

		if (existingOptions.length > 0) {
			const [{ referencedCount }] = await db
				.select({ referencedCount: count() })
				.from(productCharacteristicValue)
				.where(
					inArray(
						productCharacteristicValue.optionId,
						existingOptions.map((o) => o.id),
					),
				);

			if (referencedCount > 0) {
				errors.push({
					row: parsed.rowNum,
					message: `Impossibile aggiornare le opzioni di "${parsed.name}": ${referencedCount} valore/i prodotto ancora collegato/i alle opzioni esistenti.`,
				});
				continue;
			}
		}

		toUpdate.push({ ...parsed, id: current.id });
	}

	let created = 0;
	let skipped = 0;

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

				await tx
					.delete(productCharacteristicOption)
					.where(eq(productCharacteristicOption.characteristicId, r.id));

				if (r.dataType === "enum" && r.options.length > 0) {
					await tx.insert(productCharacteristicOption).values(
						r.options.map((value, sortOrder) => ({
							characteristicId: r.id,
							value,
							sortOrder,
						})),
					);
				}

				skipped++;
			}
		});
	}

	return { created, skipped, failed: errors.length, errors };
}
