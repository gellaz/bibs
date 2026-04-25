import { seedBase } from "./base";
import { seedFixtures } from "./fixtures";

export async function seed() {
	console.log("🌱 Seeding database...");
	await seedBase();
	await seedFixtures();
	console.log("🌱 Seed complete");
}

export { seedBase, seedFixtures };
