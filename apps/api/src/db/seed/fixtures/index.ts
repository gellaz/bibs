import { seedAdmins } from "./admins";
import { seedBillingSubscriptions } from "./billing-subscriptions";
import { seedBrands } from "./brands";
import { seedCustomers } from "./customers";
import { seedDevSeller } from "./dev-seller";
import { seedExtraStores } from "./extra-stores";
import { seedPricingConfig } from "./pricing-config";
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
	await seedPricingConfig();
	await seedAdmins();
	await seedCustomers();
	await seedDevSeller();
	await seedSellers();
	await seedExtraStores();
	await seedBillingSubscriptions();
	await seedStoreImages();
	await seedTeam();
	const brandsBySeller = await seedBrands();
	await seedProducts(brandsBySeller);
}
