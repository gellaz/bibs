import { seedProductCategories, seedStoreCategories } from "./categories";
import { seedHolidayDefinitions } from "./holidays";
import { seedLocations } from "./locations";

/**
 * Base seed: idempotent reference data shared across all environments
 * (prod/staging/dev/CI). No dependency on auth. Safe to run repeatedly.
 */
export async function seedBase() {
	await seedLocations();
	await seedStoreCategories();
	await seedProductCategories();
	await seedHolidayDefinitions();
}
