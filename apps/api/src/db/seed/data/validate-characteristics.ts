/**
 * Valida i tre CSV delle caratteristiche prodotto senza toccare il database.
 *
 *   bun run apps/api/src/db/seed/data/validate-characteristics.ts
 *
 * Esce con 1 al primo controllo fallito, stampando che cosa non torna. I due
 * istogrammi finali non sono decorazione: servono a vedere a colpo d'occhio se
 * una regola di classificazione ha collassato troppe voci in una sola famiglia,
 * o se una sotto-categoria e' rimasta senza caratteristiche utili.
 *
 * Il parser CSV e' volutamente locale: lo script deve poter girare da qualsiasi
 * cwd senza l'alias `@/` e senza trascinarsi dietro il resto dell'API.
 */

const DATA_DIR = import.meta.dir;
const EXPECTED_MATRIX_ROWS = 1773;
const DATA_TYPES = ["text", "number", "boolean", "enum"] as const;

type DataType = (typeof DATA_TYPES)[number];

type DictionaryEntry = {
	name: string;
	dataType: string;
	unit: string;
	options: string[];
	line: number;
};

type MatrixRow = {
	macro: string;
	subcategory: string;
	characteristic: string;
	required: string;
	line: number;
};

/**
 * Parser CSV minimale ma corretto sui campi quotati (RFC 4180).
 *
 * Copia quasi verbatim di `@/lib/utils/csv` (duplicata solo perché questo
 * script gira senza l'alias `@/`, vedi sopra). Le semantiche coincidono oggi,
 * incluso il `trim()` dei campi: se cambia una delle due, verifica l'altra —
 * altrimenti questo gate di validazione e l'importer reale possono
 * silenziosamente divergere.
 */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const records: string[][] = [];
	let fields: string[] = [];
	let current = "";
	let inQuotes = false;
	let hasContent = false;

	const endField = () => {
		fields.push(current.trim());
		current = "";
	};
	const endRecord = () => {
		endField();
		if (hasContent) records.push(fields);
		fields = [];
		hasContent = false;
	};

	for (let i = 0; i < normalized.length; i++) {
		const char = normalized[i];
		if (inQuotes) {
			if (char === '"') {
				if (normalized[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += char;
			}
		} else if (char === '"' && current.trim() === "") {
			inQuotes = true;
			hasContent = true;
		} else if (char === ",") {
			endField();
			hasContent = true;
		} else if (char === "\n") {
			endRecord();
		} else {
			if (char !== " " && char !== "\t") hasContent = true;
			current += char;
		}
	}
	if (inQuotes) fail("CSV con un campo quotato mai chiuso");
	endRecord();

	if (records.length === 0) fail("CSV vuoto");
	return {
		headers: records[0].map((h) => h.toLowerCase()),
		rows: records.slice(1),
	};
}

function fail(message: string, details: string[] = []): never {
	console.error(`\n✗ ${message}`);
	for (const detail of details.slice(0, 20)) console.error(`    ${detail}`);
	if (details.length > 20)
		console.error(`    ... e altri ${details.length - 20}`);
	process.exit(1);
}

function ok(message: string): void {
	console.log(`✓ ${message}`);
}

async function readCsv(file: string, expectedHeaders: string[]) {
	const path = `${DATA_DIR}/${file}`;
	const raw = await Bun.file(path).text();
	if (raw.startsWith("﻿")) fail(`${file}: il file ha un BOM in testa`);
	if (!raw.endsWith("\n")) fail(`${file}: manca la newline finale`);
	if (raw.includes("\r"))
		fail(`${file}: il file ha terminatori CRLF, servono LF`);
	const { headers, rows } = parseCsv(raw);
	if (headers.join(",") !== expectedHeaders.join(",")) {
		fail(
			`${file}: intestazione "${headers.join(",")}", attesa "${expectedHeaders.join(",")}"`,
		);
	}
	return rows;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

function bar(count: number, total: number): string {
	return "█".repeat(Math.max(1, Math.round((count / total) * 40)));
}

async function main(): Promise<void> {
	console.log("Validazione dei CSV delle caratteristiche prodotto\n");

	// --- lettura -------------------------------------------------------------
	const categoryRows = await readCsv("product_categories.csv", [
		"macro_category",
		"subcategory",
	]);
	const knownPairs = new Set(
		categoryRows.map(([macro, sub]) => `${macro}|${sub}`),
	);
	ok(`product_categories.csv: ${categoryRows.length} coppie (macro, sotto)`);

	const dictionary: DictionaryEntry[] = (
		await readCsv("product_characteristics.csv", [
			"name",
			"data_type",
			"unit",
			"options",
		])
	).map((row, index) => ({
		name: row[0] ?? "",
		dataType: row[1] ?? "",
		unit: row[2] ?? "",
		options: (row[3] ?? "").split("|").filter((option) => option.length > 0),
		line: index + 2,
	}));
	ok(`product_characteristics.csv: ${dictionary.length} voci`);

	const matrix: MatrixRow[] = (
		await readCsv("product_category_characteristics.csv", [
			"macro_category",
			"subcategory",
			"characteristic",
			"required",
		])
	).map((row, index) => ({
		macro: row[0] ?? "",
		subcategory: row[1] ?? "",
		characteristic: row[2] ?? "",
		required: row[3] ?? "",
		line: index + 2,
	}));
	ok(`product_category_characteristics.csv: ${matrix.length} righe\n`);

	// --- 1. nomi unici nel dizionario ---------------------------------------
	const seen = new Set<string>();
	const duplicates: string[] = [];
	for (const entry of dictionary) {
		if (entry.name.length === 0)
			fail(`dizionario riga ${entry.line}: nome vuoto`);
		if (seen.has(entry.name))
			duplicates.push(`riga ${entry.line}: "${entry.name}"`);
		seen.add(entry.name);
	}
	if (duplicates.length > 0)
		fail("Il dizionario ha nomi duplicati", duplicates);
	ok("1. nessun nome duplicato nel dizionario");

	// --- 2. tipi validi e coerenza delle opzioni -----------------------------
	const badTypes = dictionary
		.filter((entry) => !DATA_TYPES.includes(entry.dataType as DataType))
		.map(
			(entry) =>
				`riga ${entry.line}: "${entry.name}" ha data_type "${entry.dataType}"`,
		);
	if (badTypes.length > 0)
		fail(`data_type ammessi: ${DATA_TYPES.join(", ")}`, badTypes);

	const thinEnums = dictionary
		.filter((entry) => entry.dataType === "enum" && entry.options.length < 2)
		.map(
			(entry) =>
				`riga ${entry.line}: "${entry.name}" ha ${entry.options.length} opzioni`,
		);
	if (thinEnums.length > 0)
		fail("Ogni enum vuole almeno due opzioni", thinEnums);

	const strayOptions = dictionary
		.filter((entry) => entry.dataType !== "enum" && entry.options.length > 0)
		.map(
			(entry) =>
				`riga ${entry.line}: "${entry.name}" (${entry.dataType}) ha opzioni`,
		);
	if (strayOptions.length > 0)
		fail("Solo le voci enum possono avere opzioni", strayOptions);

	const dupOptions = dictionary
		.filter((entry) => new Set(entry.options).size !== entry.options.length)
		.map((entry) => `riga ${entry.line}: "${entry.name}"`);
	if (dupOptions.length > 0) fail("Un enum ha opzioni duplicate", dupOptions);
	ok("2. ogni enum ha almeno due opzioni distinte, nessun altro tipo ne ha");

	// --- 3. unita' solo sui number ------------------------------------------
	const strayUnits = dictionary
		.filter((entry) => entry.dataType !== "number" && entry.unit.length > 0)
		.map(
			(entry) =>
				`riga ${entry.line}: "${entry.name}" (${entry.dataType}) ha unita' "${entry.unit}"`,
		);
	if (strayUnits.length > 0)
		fail("Solo le voci number possono avere un'unita'", strayUnits);
	const numbers = dictionary.filter((entry) => entry.dataType === "number");
	const unitless = numbers.filter((entry) => entry.unit.length === 0);
	ok(
		`3. unita' solo su number: ${numbers.length - unitless.length} con unita', ` +
			`${unitless.length} conteggi senza (${unitless.map((entry) => entry.name).join(", ")})`,
	);

	// --- 4. ogni caratteristica della matrice esiste nel dizionario ----------
	const byName = new Map(dictionary.map((entry) => [entry.name, entry]));
	const unknownChars = [
		...new Set(
			matrix
				.filter((row) => !byName.has(row.characteristic))
				.map((row) => row.characteristic),
		),
	];
	if (unknownChars.length > 0) {
		fail(
			"La matrice cita caratteristiche assenti dal dizionario",
			unknownChars,
		);
	}
	ok("4. ogni caratteristica della matrice esiste nel dizionario");

	const orphans = dictionary
		.filter((entry) => !matrix.some((row) => row.characteristic === entry.name))
		.map((entry) => entry.name);
	if (orphans.length > 0)
		fail("Voci del dizionario che nessuna sotto-categoria usa", orphans);
	ok("4b. nessuna voce del dizionario resta inutilizzata");

	// --- 5. ogni coppia della matrice esiste fra le categorie ----------------
	const unknownPairs = [
		...new Set(
			matrix
				.filter((row) => !knownPairs.has(`${row.macro}|${row.subcategory}`))
				.map((row) => `${row.macro} / ${row.subcategory}`),
		),
	];
	if (unknownPairs.length > 0)
		fail(
			"La matrice cita coppie assenti da product_categories.csv",
			unknownPairs,
		);
	ok("5. ogni coppia (macro, sotto) della matrice e' nota");

	// --- 6. conteggio righe --------------------------------------------------
	if (matrix.length !== EXPECTED_MATRIX_ROWS) {
		fail(
			`La matrice ha ${matrix.length} righe, attese ${EXPECTED_MATRIX_ROWS}`,
		);
	}
	ok(`6. la matrice ha ${EXPECTED_MATRIX_ROWS} righe di dati`);

	// --- 7. required sempre false -------------------------------------------
	const wrongRequired = matrix
		.filter((row) => row.required !== "false")
		.map((row) => `riga ${row.line}: "${row.required}"`);
	if (wrongRequired.length > 0)
		fail("required deve valere false su ogni riga", wrongRequired);
	ok("7. required vale false su ogni riga");

	// --- 8. Marca non compare da nessuna parte -------------------------------
	if (byName.has("Marca"))
		fail("Marca non va nel dizionario: esiste gia' come products.brandId");
	const brandRows = matrix
		.filter((row) => row.characteristic === "Marca")
		.map((row) => `riga ${row.line}`);
	if (brandRows.length > 0)
		fail(
			"Marca non va nella matrice: esiste gia' come products.brandId",
			brandRows,
		);
	ok("8. Marca non compare ne' nel dizionario ne' nella matrice");

	// --- 9. istogrammi -------------------------------------------------------
	const perSubcategory = new Map<string, number>();
	for (const row of matrix) {
		const key = `${row.macro} / ${row.subcategory}`;
		perSubcategory.set(key, (perSubcategory.get(key) ?? 0) + 1);
	}
	const counts = [...perSubcategory.values()];
	const missing = categoryRows.filter(
		([macro, sub]) => !perSubcategory.has(`${macro} / ${sub}`),
	);
	if (missing.length > 0) {
		fail(
			"Sotto-categorie senza nessuna caratteristica",
			missing.map(([macro, sub]) => `${macro} / ${sub}`),
		);
	}

	console.log("\nCaratteristiche per sotto-categoria");
	const distribution = new Map<number, number>();
	for (const count of counts)
		distribution.set(count, (distribution.get(count) ?? 0) + 1);
	for (const size of [...distribution.keys()].sort((a, b) => a - b)) {
		const subs = distribution.get(size) ?? 0;
		console.log(
			`  ${String(size).padStart(2)} caratteristiche  ${bar(subs, counts.length)} ${subs} sotto-cat.`,
		);
	}
	const min = Math.min(...counts);
	const max = Math.max(...counts);
	const minNames = [...perSubcategory.entries()]
		.filter(([, n]) => n === min)
		.map(([k]) => k);
	const maxNames = [...perSubcategory.entries()]
		.filter(([, n]) => n === max)
		.map(([k]) => k);
	console.log(
		`  minimo ${min} (${minNames.length} sotto-cat., es. ${minNames[0]})`,
	);
	console.log(`  massimo ${max} (${maxNames.join(", ")})`);
	console.log(
		`  mediana ${median(counts)}  media ${(matrix.length / counts.length).toFixed(1)}`,
	);

	console.log("\nFamiglie del dizionario");
	for (const type of DATA_TYPES) {
		const entries = dictionary.filter((entry) => entry.dataType === type);
		const share = (entries.length / dictionary.length) * 100;
		console.log(
			`  ${type.padEnd(7)} ${bar(entries.length, dictionary.length)} ${String(entries.length).padStart(3)} (${share.toFixed(1)}%)`,
		);
	}
	const dominant = DATA_TYPES.map(
		(type) => dictionary.filter((entry) => entry.dataType === type).length,
	).sort((a, b) => b - a)[0];
	if (dominant > dictionary.length / 2) {
		fail(
			`Una sola famiglia copre ${dominant} voci su ${dictionary.length}: la classificazione e' collassata`,
		);
	}

	console.log("\nTutti i controlli passati.");
}

await main();
