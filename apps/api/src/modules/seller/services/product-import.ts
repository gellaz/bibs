import { sql } from "drizzle-orm";
import { db } from "@/db";
import { product, productCategoryAssignment } from "@/db/schemas/product";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { parseCsv } from "@/lib/utils/csv";

const PRICE_REGEX = /^\d+\.\d{2}$/;
const EAN_REGEX = /^(\d{8}|\d{13})$/;

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
	ean: string | null;
	brandName: string | null;
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
	const eanIdx = headers.indexOf("ean");
	const brandIdx = headers.indexOf("brand");

	const allCategories = await db.query.productCategory.findMany({
		columns: { id: true, name: true },
	});
	const categoryMap = new Map(
		allCategories.map((c) => [c.name.toLowerCase(), c.id]),
	);

	const errors: ImportError[] = [];
	const validProducts: ValidProduct[] = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2;

		const name = row[nameIdx];
		if (!name) {
			errors.push({ row: rowNum, message: "Missing product name" });
			continue;
		}

		const price = row[priceIdx];
		if (!price || !PRICE_REGEX.test(price)) {
			errors.push({
				row: rowNum,
				message: `Invalid price: "${price ?? ""}". Expected format: "9.99"`,
			});
			continue;
		}

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

		const eanRaw = eanIdx >= 0 ? (row[eanIdx]?.trim() ?? "") : "";
		const ean = eanRaw.length > 0 ? eanRaw : null;
		if (ean !== null && !EAN_REGEX.test(ean)) {
			errors.push({
				row: rowNum,
				message: `Invalid EAN: "${ean}". Expected 8 or 13 digits`,
			});
			continue;
		}

		const brandRaw = brandIdx >= 0 ? (row[brandIdx]?.trim() ?? "") : "";
		const brandName = brandRaw.length > 0 ? brandRaw : null;

		const description = row[descIdx] || undefined;
		validProducts.push({
			name,
			description,
			price,
			categoryIds,
			ean,
			brandName,
		});
	}

	let created = 0;
	let skipped = 0;

	if (validProducts.length > 0) {
		await db.transaction(async (tx) => {
			// Batch brand upserts for all unique brand names in this import
			const uniqueBrandNames = Array.from(
				new Set(
					validProducts
						.map((p) => p.brandName)
						.filter((n): n is string => n !== null),
				),
			);
			const brandIdByLower = new Map<string, string>();
			for (const bname of uniqueBrandNames) {
				const result = await tx.execute<{ id: string }>(
					sql`INSERT INTO brands (id, seller_profile_id, name)
					     VALUES (gen_random_uuid()::text, ${sellerProfileId}, ${bname})
					     ON CONFLICT (seller_profile_id, lower(name))
					     DO UPDATE SET updated_at = now()
					     RETURNING id`,
				);
				const id = (result as unknown as { rows: { id: string }[] }).rows[0].id;
				brandIdByLower.set(bname.toLowerCase(), id);
			}

			for (let i = 0; i < validProducts.length; i++) {
				const p = validProducts[i];
				const rowNum = i + 2;
				const brandId = p.brandName
					? (brandIdByLower.get(p.brandName.toLowerCase()) ?? null)
					: null;

				try {
					// tx.transaction() uses a SAVEPOINT internally so a unique-violation
					// aborts only this nested block, not the whole import transaction.
					await tx.transaction(async (nested) => {
						const [inserted] = await nested
							.insert(product)
							.values({
								sellerProfileId,
								name: p.name,
								description: p.description,
								price: p.price,
								ean: p.ean,
								brandId,
							})
							.returning({ id: product.id });

						if (p.categoryIds.length > 0) {
							await nested.insert(productCategoryAssignment).values(
								p.categoryIds.map((categoryId) => ({
									productId: inserted.id,
									productCategoryId: categoryId,
								})),
							);
						}
					});
					created++;
				} catch (err: unknown) {
					// Drizzle wraps pg errors in DrizzleQueryError; the original pg
					// DatabaseError (with .code and .constraint) lives in .cause.
					const pg = (
						err instanceof Error && err.cause != null ? err.cause : err
					) as { code?: string; constraint?: string };
					if (
						pg.code === "23505" &&
						(pg.constraint === "product_seller_ean_unique" ||
							/ean/.test(pg.constraint ?? ""))
					) {
						errors.push({
							row: rowNum,
							message: `EAN già usato per un altro prodotto del venditore: "${p.ean}"`,
						});
						skipped++;
						continue;
					}
					throw err;
				}
			}
		});
	}

	return { created, skipped, failed: errors.length, errors };
}
