import { sql } from "drizzle-orm";
import { db } from "@/db";
import { product, storeProduct } from "@/db/schemas/product";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { parseCsv } from "@/lib/utils/csv";

const PRICE_REGEX = /^\d+\.\d{2}$/;
const EAN_REGEX = /^(\d{8}|\d{13})$/;

const EXPECTED_HEADERS = ["name", "description", "price", "categories"];

interface RowMessage {
	row: number;
	message: string;
}

/**
 * `failed` conta solo le righe in `errors`. Una riga saltata (EAN già usato) o
 * importata con qualcosa scartato (categorie oltre la prima) va in `warnings`:
 * created + skipped + failed = righe del file.
 */
interface ImportResult {
	created: number;
	skipped: number;
	failed: number;
	errors: RowMessage[];
	warnings: RowMessage[];
}

interface ValidProduct {
	rowNum: number;
	name: string;
	description: string | undefined;
	price: string;
	categoryId: string;
	ean: string | null;
	brandName: string | null;
}

interface ImportProductsParams {
	sellerProfileId: string;
	storeId: string;
	csvText: string;
}

/**
 * L'import CREA soltanto: una riga con un EAN già usato viene saltata e il
 * prodotto esistente resta intatto. Per questo non può cambiare la
 * sotto-categoria di un prodotto che ha valori, e non gli serve la conferma di
 * D10 che il form chiede. I prodotti creati da qui nascono senza caratteristiche
 * (il CSV non ha le loro colonne), anche dove alcune sono obbligatorie.
 *
 * Se un giorno l'import aggiornerà prodotti esistenti, un cambio di
 * sotto-categoria che fa perdere valori va RIFIUTATO come errore di riga, con
 * l'elenco dei valori persi: un CSV non ha un dialog, e un file ricaricato
 * identico non deve cancellare dati a sorpresa.
 */
export async function importProductsFromCsv(
	params: ImportProductsParams,
): Promise<ImportResult> {
	const { sellerProfileId, storeId, csvText } = params;

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

	const errors: RowMessage[] = [];
	const warnings: RowMessage[] = [];
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

		// Il prodotto tiene una sola categoria: le altre non spariscono in
		// silenzio, finiscono negli avvisi.
		if (categoryNames.length > 1) {
			warnings.push({
				row: rowNum,
				message: `Il prodotto tiene solo la prima categoria ("${categoryNames[0]}"); ignorate: ${categoryNames.slice(1).join(", ")}`,
			});
		}

		const description = row[descIdx] || undefined;
		validProducts.push({
			rowNum,
			name,
			description,
			price,
			categoryId: categoryIds[0],
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

			for (const p of validProducts) {
				const { rowNum } = p;
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
								productCategoryId: p.categoryId,
							})
							.returning({ id: product.id });

						await nested.insert(storeProduct).values({
							productId: inserted.id,
							storeId,
							stock: 0,
						});
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
						warnings.push({
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

	return { created, skipped, failed: errors.length, errors, warnings };
}
