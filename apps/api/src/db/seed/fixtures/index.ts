import { seedAdmins } from "./admins";
import { seedBillingSubscriptions } from "./billing-subscriptions";
import { seedBrands } from "./brands";
import { seedCharacteristicValues } from "./characteristic-values";
import { seedCustomers } from "./customers";
import { seedDevSeller } from "./dev-seller";
import { seedDiscounts } from "./discounts";
import { seedExtraStores } from "./extra-stores";
import { seedOrders } from "./orders";
import { seedPricingConfig } from "./pricing-config";
import { seedProducts } from "./products";
import { seedSellers } from "./sellers";
import { seedStoreImages } from "./store-images";
import { seedStoreProfiles } from "./store-profiles";
import { seedTeam } from "./team";

/**
 * Fixture seed: test users (admins, customers, sellers) + multi-store, team,
 * brands, products, inventory, discounts and placeholder images for dev/staging.
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
	await seedStoreProfiles();
	await seedTeam();
	const brandsBySeller = await seedBrands();
	await seedProducts(brandsBySeller);
	// Dopo i prodotti: serve la loro product_category_id già valorizzata.
	await seedCharacteristicValues();
	await seedDiscounts();
	// Dopo prodotti e sconti: gli ordini leggono prezzi e promo vere.
	await seedOrders();
}
