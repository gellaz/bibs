import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { count } from "drizzle-orm";
import { db } from "@/db";
import { productCharacteristic } from "@/db/schemas/product-characteristic";
import {
	importCategoryCharacteristicsFromCsv,
	importCharacteristicsFromCsv,
} from "@/modules/admin/services/characteristic-import";

// I due CSV vivono accanto al codice del seed in `../data`, come le categorie.
const DATA_DIR = resolve(import.meta.dir, "../data");
const CHARACTERISTICS_CSV = resolve(DATA_DIR, "product_characteristics.csv");
const CATEGORY_CHARACTERISTICS_CSV = resolve(
	DATA_DIR,
	"product_category_characteristics.csv",
);

/**
 * Semina il dizionario delle caratteristiche prodotto e la matrice
 * categoria-caratteristiche da CSV.
 *
 * Il dizionario va importato PRIMA della matrice: la matrice referenzia le
 * caratteristiche per nome, e senza il dizionario già popolato fallirebbe su
 * ogni riga.
 */
export async function seedProductCharacteristics() {
	const [{ total }] = await db
		.select({ total: count() })
		.from(productCharacteristic);
	if (total > 0) {
		console.log("  ⏭ Product characteristics already seeded, skipping");
		return;
	}

	console.log("  🔤 Seeding product characteristics dictionary from CSV...");
	const dictionaryCsv = readFileSync(CHARACTERISTICS_CSV, "utf8");
	const dictionaryResult = await importCharacteristicsFromCsv(dictionaryCsv);
	console.log(
		`     ✓ ${dictionaryResult.created} caratteristiche create (aggiornate: ${dictionaryResult.updated}, fallite: ${dictionaryResult.failed})`,
	);

	console.log("  🧩 Seeding category-characteristic matrix from CSV...");
	const matrixCsv = readFileSync(CATEGORY_CHARACTERISTICS_CSV, "utf8");
	const matrixResult = await importCategoryCharacteristicsFromCsv(matrixCsv);
	console.log(
		`     ✓ ${matrixResult.created} righe di matrice create (saltate: ${matrixResult.skipped}, fallite: ${matrixResult.failed})`,
	);
}
