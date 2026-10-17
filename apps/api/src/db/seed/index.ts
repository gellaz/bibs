import { seedBase } from "./base";
import { seedFixtures } from "./fixtures";
import { type SeedOnly, seedGroups } from "./groups";

// Testo derivato dai gruppi: dice anche cosa salta.
function describeMode(only?: SeedOnly) {
	if (!only) return "tutto";
	const g = seedGroups(only);
	const skipped = [
		!g.customer && "customer",
		!g.seller && "seller",
		!g.orders && "ordini",
	].filter(Boolean);
	return `solo ${only}: niente ${skipped.join(", ").replace(/, ([^,]*)$/, " né $1")}`;
}

export async function seed(only?: SeedOnly) {
	console.log(`🌱 Seeding database (${describeMode(only)})...`);
	await seedBase();
	await seedFixtures(seedGroups(only));
	console.log("🌱 Seed complete");
}

export { seedBase, seedFixtures };
