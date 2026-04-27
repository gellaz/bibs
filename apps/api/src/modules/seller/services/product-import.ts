import { db } from "@/db";
import { product, productClassification } from "@/db/schemas/product";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { parseCsv } from "@/lib/utils/csv";

const PRICE_REGEX = /^\d+\.\d{2}$/;

const EXPECTED_HEADERS = ["name", "description", "price", "categories"];

interface ImportError {
	row: number;
	message: string;
}

interface ImportResult {
	created: number;
	skipped: number;
	failed: number;
	errors: ImportError[];
}

interface ValidProduct {
	name: string;
	description: string | undefined;
	price: string;
	categoryIds: string[];
}

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
				`Missing CSV header: "${expected}". Expected headers: ${EXPECTED_HEADERS.join(", ")}`,
			);
		}
	}

	if (rows.length === 0) {
		throw new ServiceError(400, "CSV file contains no data rows");
	}

	if (rows.length > config.maxProductsPerImport) {
		throw new ServiceError(
			400,
			`Too many products: ${rows.length}. Maximum allowed: ${config.maxProductsPerImport}`,
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
	const validProducts: ValidProduct[] = [];

	// ── Phase 1: validate all rows ─────────────
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2; // 1-indexed, +1 for header

		// Validate name
		const name = row[nameIdx];
		if (!name) {
			errors.push({ row: rowNum, message: "Missing product name" });
			continue;
		}

		// Validate price
		const price = row[priceIdx];
		if (!price || !PRICE_REGEX.test(price)) {
			errors.push({
				row: rowNum,
				message: `Invalid price: "${price ?? ""}". Expected format: "9.99"`,
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
				message: "At least one category is required",
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
				message: `Categories not found: ${unknownCategories.join(", ")}`,
			});
			continue;
		}

		const description = row[descIdx] || undefined;
		validProducts.push({ name, description, price, categoryIds });
	}

	// ── Phase 2: batch insert in a single transaction ──
	let created = 0;

	if (validProducts.length > 0) {
		await db.transaction(async (tx) => {
			const inserted = await tx
				.insert(product)
				.values(
					validProducts.map((p) => ({
						sellerProfileId,
						name: p.name,
						description: p.description,
						price: p.price,
					})),
				)
				.returning({ id: product.id });

			const classifications = inserted.flatMap((row, idx) =>
				validProducts[idx].categoryIds.map((categoryId) => ({
					productId: row.id,
					productCategoryId: categoryId,
				})),
			);

			if (classifications.length > 0) {
				await tx.insert(productClassification).values(classifications);
			}

			created = inserted.length;
		});
	}

	return { created, skipped: 0, failed: errors.length, errors };
}
