import { seedAdmins } from "./admins";
import { seedCustomers } from "./customers";
import { seedSellers } from "./sellers";

/**
 * Fixture seed: test users (admins, customers, sellers) for dev/staging.
 * Depends on better-auth (uses `auth.api.signUpEmail`). Not for production.
 */
export async function seedFixtures() {
	await seedAdmins();
	await seedCustomers();
	await seedSellers();
}
