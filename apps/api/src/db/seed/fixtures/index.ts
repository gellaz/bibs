import type { SeedGroups } from "../groups";
import { seedAdmins } from "./admins";
import { seedBillingSubscriptions } from "./billing-subscriptions";
import { seedBrands } from "./brands";
import { seedCharacteristicValues } from "./characteristic-values";
import { seedCustomers } from "./customers";
import { seedDevSeller } from "./dev-seller";
import {
	seedDevSellerCatalog,
	seedDevSellerOrders,
} from "./dev-seller-catalog";
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
export async function seedFixtures(groups: SeedGroups) {
	await seedPricingConfig();
	await seedAdmins();
	if (groups.customer) await seedCustomers();
	if (groups.seller) {
		await seedDevSeller();
		await seedSellers();
		await seedExtraStores();
		await seedBillingSubscriptions();
		await seedStoreImages();
		await seedStoreProfiles();
		await seedTeam();
		const brandsBySeller = await seedBrands();
		await seedProducts(brandsBySeller);
		// Il catalogo del venditore di sviluppo, che seedProducts lascia fuori.
		await seedDevSellerCatalog();
		// Dopo i prodotti: serve la loro product_category_id già valorizzata.
		await seedCharacteristicValues();
		await seedDiscounts();
	}
	if (groups.orders) {
		// Dopo prodotti e sconti: gli ordini leggono prezzi e promo vere.
		await seedOrders();
		await seedDevSellerOrders();
	}
}
