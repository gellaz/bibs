import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { auth } from "@/lib/auth";
import { firstNames, lastNames, pick } from "./utils";

// ── Configuration ────────────────────────────────────────

const CUSTOMER_COUNT = 300;
const LOG_INTERVAL = 50;

// ── Generator ───────────────────────────────────────────

interface CustomerSeedData {
	email: string;
	name: string;
}

function generateCustomersSeedData(): CustomerSeedData[] {
	const customers: CustomerSeedData[] = [];

	for (let i = 0; i < CUSTOMER_COUNT; i++) {
		const firstName = pick(firstNames, i, 1);
		const lastName = pick(lastNames, i, 3, 7);

		customers.push({
			email: `customer${i + 1}@test.com`,
			name: `${firstName} ${lastName}`,
		});
	}

	return customers;
}

// ── Seeding function ────────────────────────────────────

export async function seedCustomers() {
	const existing = await db.query.user.findFirst({
		where: eq(user.email, "customer1@test.com"),
	});
	if (existing) {
		console.log("  ⏭ Bulk customers already seeded, skipping");
		return;
	}

	const customersData = generateCustomersSeedData();
	console.log(`  👥 Seeding ${customersData.length} customers...`);

	// Phase 1: Create users via auth (sequential — password hashing)
	const created: string[] = [];
	for (let i = 0; i < customersData.length; i++) {
		const c = customersData[i];
		try {
			const { user: u } = await auth.api.signUpEmail({
				body: { name: c.name, email: c.email, password: "password123" },
			});
			await db
				.update(user)
				.set({ role: "customer", emailVerified: true })
				.where(eq(user.id, u.id));
			created.push(u.id);
		} catch {
			console.error(`     ✗ Failed: ${c.email}`);
		}
		if ((i + 1) % LOG_INTERVAL === 0) {
			console.log(`     ... ${i + 1}/${customersData.length} users`);
		}
	}

	if (created.length === 0) return;

	// Phase 2: Batch insert customer profiles
	await db
		.insert(customerProfile)
		.values(created.map((userId) => ({ userId })));

	console.log(`  ✓ ${created.length} customers seeded`);
}
