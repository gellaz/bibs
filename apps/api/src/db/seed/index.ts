import { seedBase } from "./base";
import { seedFixtures } from "./fixtures";
import { type SeedOnly, seedGroups } from "./groups";

export async function seed(only?: SeedOnly) {
	console.log(`🌱 Seeding database (${only ? `solo ${only}` : "tutto"})...`);
	await seedBase();
	await seedFixtures(seedGroups(only));
	console.log("🌱 Seed complete");
}

export { seedBase, seedFixtures };
