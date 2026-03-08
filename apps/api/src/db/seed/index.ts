import { seedAdmins } from "./admins";
import { seedProductCategories, seedStoreCategories } from "./categories";
import { seedCustomers } from "./customers";
import { seedLocations } from "./locations";
import { seedSellers } from "./sellers";

export async function seed() {
	console.log("🌱 Seeding database...");

	// Reference data (idempotent — skips if already present)
	await seedLocations();
	await seedStoreCategories();
	await seedProductCategories();

	// Test data
	await seedAdmins();
	await seedCustomers();
	await seedSellers();

	console.log("🌱 Seed complete");
}
