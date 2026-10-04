import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { pointTransaction } from "@/db/schemas/points";
import { auth } from "@/lib/auth";
import { firstNames, lastNames, pick } from "./utils";

// ── Configuration ────────────────────────────────────────

const CUSTOMER_COUNT = 300;
const LOG_INTERVAL = 50;

/**
 * Saldo punti dei primi clienti (customer1…5@test.com), così la pill saffron e
 * /points hanno qualcosa da mostrare col login di sviluppo. Un movimento
 * `earned` senza ordine per cliente: Σ movimenti = saldo.
 */
const WELCOME_POINTS = [250, 120, 45, 10, 1];

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
	const created: { userId: string; email: string }[] = [];
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
			created.push({ userId: u.id, email: c.email });
		} catch (error) {
			console.error(`     ✗ Failed: ${c.email}`, error);
		}
		if ((i + 1) % LOG_INTERVAL === 0) {
			console.log(`     ... ${i + 1}/${customersData.length} users`);
		}
	}

	if (created.length === 0) return;

	// Phase 2: Batch insert customer profiles, with the welcome balance
	const pointsByEmail = new Map(
		WELCOME_POINTS.map((points, i) => [`customer${i + 1}@test.com`, points]),
	);
	const profiles = await db
		.insert(customerProfile)
		.values(
			created.map(({ userId, email }) => ({
				userId,
				points: pointsByEmail.get(email) ?? 0,
			})),
		)
		.returning({
			id: customerProfile.id,
			points: customerProfile.points,
		});

	const withPoints = profiles.filter((p) => p.points > 0);
	if (withPoints.length > 0) {
		await db.insert(pointTransaction).values(
			withPoints.map((p) => ({
				customerProfileId: p.id,
				amount: p.points,
				type: "earned" as const,
				description: "Bonus di benvenuto",
			})),
		);
	}

	console.log(
		`  ✓ ${created.length} customers seeded (${withPoints.length} with points)`,
	);
}
