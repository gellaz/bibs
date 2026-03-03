import { db } from "@/db";
import { product, productClassification } from "@/db/schemas/product";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";

const PRICE_REGEX = /^\d+\.\d{2}$/;

const EXPECTED_HEADERS = ["name", "description", "price", "categories"];

interface ImportError {
	row: number;
	message: string;
}

interface ImportResult {
	created: number;
	failed: number;
	errors: ImportError[];
}

// ────────────────────────────────────────────
// CSV parsing
// ────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (inQuotes) {
			if (char === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += char;
			}
		} else if (char === '"') {
			inQuotes = true;
		} else if (char === ",") {
			fields.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}
	fields.push(current.trim());
	return fields;
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
	const lines = text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.split("\n")
		.filter((l) => l.trim() !== "");

	if (lines.length === 0) {
		throw new ServiceError(400, "Il file CSV è vuoto");
	}

	const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
	const rows = lines.slice(1).map(parseCsvLine);
	return { headers, rows };
}

// ────────────────────────────────────────────
// Import logic
// ────────────────────────────────────────────

interface ImportProductsParams {
	sellerProfileId: string;
	csvText: string;
}

export async function importProductsFromCsv(
	params: ImportProductsParams,
): Promise<ImportResult> {
	const { sellerProfileId, csvText } = params;

	const { headers, rows } = parseCsv(csvText);

	// Validate headers
	for (const expected of EXPECTED_HEADERS) {
		if (!headers.includes(expected)) {
			throw new ServiceError(
				400,
				`Intestazione CSV mancante: "${expected}". Intestazioni attese: ${EXPECTED_HEADERS.join(", ")}`,
			);
		}
	}

	if (rows.length === 0) {
		throw new ServiceError(400, "Il file CSV non contiene righe di dati");
	}

	if (rows.length > config.maxProductsPerImport) {
		throw new ServiceError(
			400,
			`Troppi prodotti: ${rows.length}. Massimo consentito: ${config.maxProductsPerImport}`,
		);
	}

	const nameIdx = headers.indexOf("name");
	const descIdx = headers.indexOf("description");
	const priceIdx = headers.indexOf("price");
	const catIdx = headers.indexOf("categories");

	// Fetch all categories once and build a name→id map (case-insensitive)
	const allCategories = await db.query.productCategory.findMany({
		columns: { id: true, name: true },
	});
	const categoryMap = new Map(
		allCategories.map((c) => [c.name.toLowerCase(), c.id]),
	);

	const errors: ImportError[] = [];
	let created = 0;

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2; // 1-indexed, +1 for header

		// Validate name
		const name = row[nameIdx];
		if (!name) {
			errors.push({ row: rowNum, message: "Nome prodotto mancante" });
			continue;
		}

		// Validate price
		const price = row[priceIdx];
		if (!price || !PRICE_REGEX.test(price)) {
			errors.push({
				row: rowNum,
				message: `Prezzo non valido: "${price ?? ""}". Formato atteso: "9.99"`,
			});
			continue;
		}

		// Resolve categories
		const categoriesRaw = row[catIdx] ?? "";
		const categoryNames = categoriesRaw
			.split(";")
			.map((c) => c.trim())
			.filter(Boolean);

		if (categoryNames.length === 0) {
			errors.push({
				row: rowNum,
				message: "Almeno una categoria obbligatoria",
			});
			continue;
		}

		const categoryIds: string[] = [];
		const unknownCategories: string[] = [];
		for (const catName of categoryNames) {
			const catId = categoryMap.get(catName.toLowerCase());
			if (catId) {
				categoryIds.push(catId);
			} else {
				unknownCategories.push(catName);
			}
		}

		if (unknownCategories.length > 0) {
			errors.push({
				row: rowNum,
				message: `Categorie non trovate: ${unknownCategories.join(", ")}`,
			});
			continue;
		}

		const description = row[descIdx] || undefined;

		// Create product + classifications in a transaction
		try {
			await db.transaction(async (tx) => {
				const [inserted] = await tx
					.insert(product)
					.values({ sellerProfileId, name, description, price })
					.returning();

				await tx.insert(productClassification).values(
					categoryIds.map((categoryId) => ({
						productId: inserted.id,
						productCategoryId: categoryId,
					})),
				);
			});
			created++;
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Errore sconosciuto";
			errors.push({ row: rowNum, message });
		}
	}

	return { created, failed: errors.length, errors };
}
