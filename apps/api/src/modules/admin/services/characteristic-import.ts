import { count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import {
	CHARACTERISTIC_DATA_TYPES,
	type CharacteristicDataType,
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
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
		throw new ServiceError(400, "Il file CSV non contiene righe di dati.");
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

// ────────────────────────────────────────────
// Category ↔ characteristic matrix
// ────────────────────────────────────────────

const MATRIX_HEADERS = [
	"macro_category",
	"subcategory",
	"characteristic",
	"required",
];

export interface MissingCategoryCharacteristics {
	subcategory: string;
	// Il nome della sotto-categoria da solo non è univoco (vedi `pairKey`):
	// senza la macro, "Stampanti" o "Pennelli" comparirebbero come due voci
	// identiche e indistinguibili nel rapporto.
	macroCategory: string;
	characteristics: string[];
}

export interface CategoryCharacteristicImportResult {
	created: number;
	skipped: number;
	failed: number;
	errors: ImportError[];
	missing: MissingCategoryCharacteristics[];
}

interface MatrixParsedRow {
	rowNum: number;
	macroName: string;
	subName: string;
	charName: string;
	required: boolean;
}

interface MatrixResolvedRow {
	rowNum: number;
	categoryId: string;
	characteristicId: string;
	required: boolean;
}

// Chiave composta macro+sotto-categoria (o categoria+caratteristica): il nome
// della sotto-categoria da solo NON è univoco, si ripete sotto macro diverse
// (es. "Stampanti" in Elettronica e in Ufficio e scuola).
function pairKey(a: string, b: string): string {
	return `${a}\u0000${b}`;
}

/**
 * Importa la matrice categoria-caratteristiche da CSV: quali caratteristiche
 * si applicano a quale sotto-categoria prodotto, con `required` per riga.
 *
 * L'import è **solo additivo**: non cancella mai una riga esistente nel
 * database. In cambio calcola comunque il confronto e riporta in `missing`
 * le righe presenti nel database e assenti dal file, raggruppate per
 * sotto-categoria — solo per le sotto-categorie che il file cita (una
 * sotto-categoria assente dal file non compare: il file non dice nulla su di
 * lei, quindi non c'è divergenza da segnalare).
 */
export async function importCategoryCharacteristicsFromCsv(
	csvText: string,
): Promise<CategoryCharacteristicImportResult> {
	const { headers, rows } = parseCsv(csvText);
	assertHeaders(headers, MATRIX_HEADERS);

	if (rows.length === 0) {
		throw new ServiceError(400, "Il file CSV non contiene righe di dati.");
	}

	const macroIdx = headers.indexOf("macro_category");
	const subIdx = headers.indexOf("subcategory");
	const charIdx = headers.indexOf("characteristic");
	const requiredIdx = headers.indexOf("required");

	const errors: ImportError[] = [];
	const parsedRows: MatrixParsedRow[] = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2; // 1-indicizzato + intestazione

		const macroName = (row[macroIdx] ?? "").trim();
		const subName = (row[subIdx] ?? "").trim();
		const charName = (row[charIdx] ?? "").trim();
		const requiredRaw = (row[requiredIdx] ?? "").trim().toLowerCase();

		if (!macroName) {
			errors.push({ row: rowNum, message: "Macro categoria mancante" });
			continue;
		}
		if (!subName) {
			errors.push({ row: rowNum, message: "Sotto-categoria mancante" });
			continue;
		}
		if (!charName) {
			errors.push({ row: rowNum, message: "Caratteristica mancante" });
			continue;
		}
		if (requiredRaw !== "true" && requiredRaw !== "false") {
			errors.push({
				row: rowNum,
				message: `Valore non valido per "required": "${row[requiredIdx] ?? ""}". Valori ammessi: true, false.`,
			});
			continue;
		}

		parsedRows.push({
			rowNum,
			macroName,
			subName,
			charName,
			required: requiredRaw === "true",
		});
	}

	if (parsedRows.length === 0) {
		return {
			created: 0,
			skipped: 0,
			failed: errors.length,
			errors,
			missing: [],
		};
	}

	// Risolvere sotto-categoria (macro+nome, perché il nome da solo si ripete)
	// e caratteristica (nome, univoco nel dizionario) verso i rispettivi id.
	const macroNames = Array.from(new Set(parsedRows.map((r) => r.macroName)));
	const categoryRows = await db
		.select({
			id: productCategory.id,
			subName: productCategory.name,
			macroName: productMacroCategory.name,
		})
		.from(productCategory)
		.innerJoin(
			productMacroCategory,
			eq(productCategory.macroCategoryId, productMacroCategory.id),
		)
		.where(inArray(productMacroCategory.name, macroNames));

	const categoryByPair = new Map(
		categoryRows.map((c) => [pairKey(c.macroName, c.subName), c]),
	);

	const charNames = Array.from(new Set(parsedRows.map((r) => r.charName)));
	const characteristics = await db
		.select({ id: productCharacteristic.id, name: productCharacteristic.name })
		.from(productCharacteristic)
		.where(inArray(productCharacteristic.name, charNames));

	const characteristicByName = new Map(characteristics.map((c) => [c.name, c]));

	// Sotto-categorie "citate dal file": lo sono SOLO se almeno una riga vi si
	// riferisce risolvendo per intero (sotto-categoria E caratteristica). Una
	// riga con la sotto-categoria giusta ma la caratteristica sbagliata non
	// basta: altrimenti un singolo refuso farebbe apparire come "mancanti"
	// tutte le caratteristiche già collegate a quella sotto-categoria, lo
	// stesso "muro di falsi allarmi" che la regola sulle sotto-categorie mai
	// citate esiste per evitare — solo innescato da una citazione parziale
	// invece che dall'assenza totale.
	const mentionedCategoryNames = new Map<
		string,
		{ subName: string; macroName: string }
	>();
	const resolvedRows: MatrixResolvedRow[] = [];

	for (const r of parsedRows) {
		const category = categoryByPair.get(pairKey(r.macroName, r.subName));
		if (!category) {
			errors.push({
				row: r.rowNum,
				message: `Sotto-categoria sconosciuta: "${r.subName}" (macro "${r.macroName}").`,
			});
			continue;
		}

		const characteristic = characteristicByName.get(r.charName);
		if (!characteristic) {
			errors.push({
				row: r.rowNum,
				message: `Caratteristica sconosciuta: "${r.charName}".`,
			});
			continue;
		}

		mentionedCategoryNames.set(category.id, {
			subName: category.subName,
			macroName: category.macroName,
		});
		resolvedRows.push({
			rowNum: r.rowNum,
			categoryId: category.id,
			characteristicId: characteristic.id,
			required: r.required,
		});
	}

	// sortOrder contato per sotto-categoria (non globalmente): la prima
	// caratteristica di ogni sotto-categoria nel file è 0. Consuma una
	// posizione anche una riga già presente nel database — è l'ordine nel
	// FILE a contare, non l'ordine di inserimento.
	const sortCounters = new Map<string, number>();
	const seenPairs = new Set<string>();
	const candidateRows: {
		categoryId: string;
		characteristicId: string;
		required: boolean;
		sortOrder: number;
	}[] = [];

	for (const row of resolvedRows) {
		const nextSortOrder = sortCounters.get(row.categoryId) ?? 0;
		sortCounters.set(row.categoryId, nextSortOrder + 1);

		const key = pairKey(row.categoryId, row.characteristicId);
		if (seenPairs.has(key)) continue; // stessa riga ripetuta nel file
		seenPairs.add(key);

		candidateRows.push({
			categoryId: row.categoryId,
			characteristicId: row.characteristicId,
			required: row.required,
			sortOrder: nextSortOrder,
		});
	}

	const categoryIds = Array.from(mentionedCategoryNames.keys());
	const existingLinks =
		categoryIds.length > 0
			? await db
					.select({
						categoryId: productCategoryCharacteristic.productCategoryId,
						characteristicId: productCategoryCharacteristic.characteristicId,
						characteristicName: productCharacteristic.name,
					})
					.from(productCategoryCharacteristic)
					.innerJoin(
						productCharacteristic,
						eq(
							productCategoryCharacteristic.characteristicId,
							productCharacteristic.id,
						),
					)
					.where(
						inArray(
							productCategoryCharacteristic.productCategoryId,
							categoryIds,
						),
					)
			: [];

	const existingKeySet = new Set(
		existingLinks.map((l) => pairKey(l.categoryId, l.characteristicId)),
	);

	let skipped = 0;
	const toInsert: typeof candidateRows = [];
	for (const row of candidateRows) {
		const key = pairKey(row.categoryId, row.characteristicId);
		if (existingKeySet.has(key)) {
			skipped++;
		} else {
			toInsert.push(row);
		}
	}

	let created = 0;
	if (toInsert.length > 0) {
		await db.insert(productCategoryCharacteristic).values(
			toInsert.map((r) => ({
				productCategoryId: r.categoryId,
				characteristicId: r.characteristicId,
				required: r.required,
				sortOrder: r.sortOrder,
			})),
		);
		created = toInsert.length;
	}

	// missing: righe nel database (per le sotto-categorie citate dal file)
	// la cui caratteristica il file non menziona per quella sotto-categoria.
	const fileCharsByCategory = new Map<string, Set<string>>();
	for (const row of resolvedRows) {
		const set = fileCharsByCategory.get(row.categoryId) ?? new Set<string>();
		set.add(row.characteristicId);
		fileCharsByCategory.set(row.categoryId, set);
	}

	const missingByCategory = new Map<string, string[]>();
	for (const link of existingLinks) {
		const fileChars = fileCharsByCategory.get(link.categoryId);
		if (fileChars?.has(link.characteristicId)) continue;

		const names = missingByCategory.get(link.categoryId) ?? [];
		names.push(link.characteristicName);
		missingByCategory.set(link.categoryId, names);
	}

	const missing = Array.from(missingByCategory.entries())
		.map(([categoryId, characteristics]) => {
			const names = mentionedCategoryNames.get(categoryId);
			return {
				subcategory: names?.subName ?? "",
				macroCategory: names?.macroName ?? "",
				characteristics: characteristics.sort((a, b) => a.localeCompare(b)),
			};
		})
		// Ordina sulla coppia (macro, sotto-categoria): il solo nome della
		// sotto-categoria non è univoco (vedi `pairKey`), quindi due voci
		// omonime sotto macro diverse finirebbero adiacenti e indistinguibili.
		.sort((a, b) => {
			const macroCompare = a.macroCategory.localeCompare(b.macroCategory);
			return macroCompare !== 0
				? macroCompare
				: a.subcategory.localeCompare(b.subcategory);
		});

	return { created, skipped, failed: errors.length, errors, missing };
}
