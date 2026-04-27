import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { storeCategory } from "@/db/schemas/store-category";
import { ServiceError } from "@/lib/errors";
import { parseCsv } from "@/lib/utils/csv";

interface ImportError {
	row: number;
	message: string;
}

export interface CategoryImportResult {
	created: number;
	skipped: number;
	failed: number;
	errors: ImportError[];
}

const PRODUCT_HEADERS = ["macro_category", "subcategory"];
const STORE_HEADERS = ["name"];

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

// ────────────────────────────────────────────
// Product categories (macro + sub)
// ────────────────────────────────────────────

export async function importProductCategoriesFromCsv(
	csvText: string,
): Promise<CategoryImportResult> {
	const { headers, rows } = parseCsv(csvText);
	assertHeaders(headers, PRODUCT_HEADERS);

	if (rows.length === 0) {
		throw new ServiceError(400, "CSV file contains no data rows");
	}

	const macroIdx = headers.indexOf("macro_category");
	const subIdx = headers.indexOf("subcategory");

	// Pre-load existing data (case-insensitive lookups)
	const [existingMacros, existingSubs] = await Promise.all([
		db.query.productMacroCategory.findMany({
			columns: { id: true, name: true },
		}),
		db.query.productCategory.findMany({
			columns: { id: true, name: true, macroCategoryId: true },
		}),
	]);

	const macroByName = new Map(
		existingMacros.map((m) => [m.name.toLowerCase(), m]),
	);
	const subKey = (macroId: string, name: string) =>
		`${macroId}|${name.toLowerCase()}`;
	const existingSubKeys = new Set(
		existingSubs.map((s) => subKey(s.macroCategoryId, s.name)),
	);

	const errors: ImportError[] = [];
	const macrosToCreate = new Map<string, string>(); // lowercaseName → originalName
	// Pending sub-categories: keyed by lowercase macro + lowercase sub to dedup within the CSV itself
	const pendingSubs = new Map<
		string,
		{ macroNameLower: string; macroNameOriginal: string; subName: string }
	>();
	let skipped = 0;

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2; // 1-indexed + header

		const macroName = (row[macroIdx] ?? "").trim();
		const subName = (row[subIdx] ?? "").trim();

		if (!macroName) {
			errors.push({ row: rowNum, message: "Missing macro_category" });
			continue;
		}
		if (!subName) {
			errors.push({ row: rowNum, message: "Missing subcategory" });
			continue;
		}

		const macroLower = macroName.toLowerCase();
		const macroExisting = macroByName.get(macroLower);

		if (macroExisting) {
			const key = subKey(macroExisting.id, subName);
			if (existingSubKeys.has(key)) {
				skipped++;
			} else {
				const dedupKey = `${macroLower}|${subName.toLowerCase()}`;
				if (pendingSubs.has(dedupKey)) {
					skipped++;
				} else {
					pendingSubs.set(dedupKey, {
						macroNameLower: macroLower,
						macroNameOriginal: macroExisting.name,
						subName,
					});
				}
			}
		} else {
			// Macro doesn't exist yet — schedule its creation and the sub
			if (!macrosToCreate.has(macroLower)) {
				macrosToCreate.set(macroLower, macroName);
			}
			const dedupKey = `${macroLower}|${subName.toLowerCase()}`;
			if (pendingSubs.has(dedupKey)) {
				skipped++;
			} else {
				pendingSubs.set(dedupKey, {
					macroNameLower: macroLower,
					macroNameOriginal: macroName,
					subName,
				});
			}
		}
	}

	let created = 0;

	if (macrosToCreate.size > 0 || pendingSubs.size > 0) {
		await db.transaction(async (tx) => {
			// Insert new macros
			if (macrosToCreate.size > 0) {
				const inserted = await tx
					.insert(productMacroCategory)
					.values(Array.from(macrosToCreate.values()).map((name) => ({ name })))
					.returning({
						id: productMacroCategory.id,
						name: productMacroCategory.name,
					});

				created += inserted.length;

				for (const m of inserted) {
					macroByName.set(m.name.toLowerCase(), { id: m.id, name: m.name });
				}
			}

			// Insert new sub-categories
			if (pendingSubs.size > 0) {
				const subValues = Array.from(pendingSubs.values()).map((p) => {
					const macro = macroByName.get(p.macroNameLower);
					if (!macro) {
						throw new ServiceError(
							500,
							`Macro category "${p.macroNameOriginal}" lookup failed after insert`,
						);
					}
					return { macroCategoryId: macro.id, name: p.subName };
				});

				const inserted = await tx
					.insert(productCategory)
					.values(subValues)
					.returning({ id: productCategory.id });

				created += inserted.length;
			}
		});
	}

	return { created, skipped, failed: errors.length, errors };
}

// ────────────────────────────────────────────
// Store categories (flat)
// ────────────────────────────────────────────

export async function importStoreCategoriesFromCsv(
	csvText: string,
): Promise<CategoryImportResult> {
	const { headers, rows } = parseCsv(csvText);
	assertHeaders(headers, STORE_HEADERS);

	if (rows.length === 0) {
		throw new ServiceError(400, "CSV file contains no data rows");
	}

	const nameIdx = headers.indexOf("name");

	const existing = await db.query.storeCategory.findMany({
		columns: { id: true, name: true },
	});
	const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

	const errors: ImportError[] = [];
	const toCreate = new Map<string, string>(); // lowercase → original
	let skipped = 0;

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2;

		const name = (row[nameIdx] ?? "").trim();

		if (!name) {
			errors.push({ row: rowNum, message: "Missing name" });
			continue;
		}

		const nameLower = name.toLowerCase();

		if (existingNames.has(nameLower)) {
			skipped++;
		} else if (toCreate.has(nameLower)) {
			skipped++;
		} else {
			toCreate.set(nameLower, name);
		}
	}

	let created = 0;

	if (toCreate.size > 0) {
		await db.transaction(async (tx) => {
			const inserted = await tx
				.insert(storeCategory)
				.values(Array.from(toCreate.values()).map((name) => ({ name })))
				.returning({ id: storeCategory.id });
			created = inserted.length;
		});
	}

	return { created, skipped, failed: errors.length, errors };
}
