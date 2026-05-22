import { seedAdmins } from "./admins";
import { seedBrands } from "./brands";
import { seedCustomers } from "./customers";
import { seedExtraStores } from "./extra-stores";
import { seedProducts } from "./products";
import { seedSellers } from "./sellers";
import { seedStoreImages } from "./store-images";
import { seedTeam } from "./team";

/**
 * Fixture seed: test users (admins, customers, sellers) + multi-store, team,
 * brands, products, inventory and placeholder images for dev/staging.
 * Depends on better-auth (uses `auth.api.signUpEmail`). Not for production.
 */
export async function seedFixtures() {
	await seedAdmins();
	await seedCustomers();
	await seedSellers();
	await seedExtraStores();
	await seedStoreImages();
	await seedTeam();
	const brandsBySeller = await seedBrands();
	await seedProducts(brandsBySeller);
}
