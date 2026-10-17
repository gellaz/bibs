import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customerAddress } from "@/db/schemas/address";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { pointTransaction } from "@/db/schemas/points";
import { auth } from "@/lib/auth";
import {
	BOLOGNA_DISTRICTS,
	firstNames,
	getSeedMunicipalityIds,
	jitter,
	lastNames,
	pick,
	SEED_MUNICIPALITIES,
	SEED_MUNICIPALITY_COORDS,
	type SeedMunicipalityHandle,
	streets,
} from "./utils";

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
	firstName: string;
	lastName: string;
	birthDate: string;
}

function generateCustomersSeedData(): CustomerSeedData[] {
	const customers: CustomerSeedData[] = [];

	for (let i = 0; i < CUSTOMER_COUNT; i++) {
		const firstName = pick(firstNames, i, 1);
		const lastName = pick(lastNames, i, 3, 7);
		// Deterministic birth date: 1960–1999
		const birthDate = `${1960 + (i % 40)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;

		customers.push({
			email: `customer${i + 1}@test.com`,
			name: `${firstName} ${lastName}`,
			firstName,
			lastName,
			birthDate,
		});
	}

	return customers;
}

// ── Rubrica indirizzi ───────────────────────────────────

/** customer1…5: «Casa» e «Lavoro» a Bologna, in quartieri diversi. */
const BOLOGNA_ADDRESS_CUSTOMERS = 5;
/** Un indirizzo predefinito ogni N customer, nei comuni vetrina. */
const SHOWCASE_ADDRESS_EVERY = 10;
const showcaseHandles = Object.keys(
	SEED_MUNICIPALITIES,
) as SeedMunicipalityHandle[];

async function seedAddresses(
	profiles: { id: string; userId: string }[],
	created: { userId: string; email: string }[],
) {
	const profileIdByUser = new Map(profiles.map((p) => [p.userId, p.id]));
	const municipalityIds = await getSeedMunicipalityIds();
	const rows: (typeof customerAddress.$inferInsert)[] = [];

	for (const { userId, email } of created) {
		const customerProfileId = profileIdByUser.get(userId);
		const n = Number(email.match(/\d+/)?.[0]);
		if (!customerProfileId) continue;

		if (n <= BOLOGNA_ADDRESS_CUSTOMERS) {
			const home = BOLOGNA_DISTRICTS[(n * 3) % BOLOGNA_DISTRICTS.length];
			const work = BOLOGNA_DISTRICTS[(n * 3 + 7) % BOLOGNA_DISTRICTS.length];
			for (const [k, place, label] of [
				[0, home, "Casa"],
				[1, work, "Lavoro"],
			] as const) {
				rows.push({
					customerProfileId,
					label,
					addressLine1: `${pick(streets, n, 5, k * 3)} ${10 + n * 4 + k * 11}`,
					municipalityId: municipalityIds.bologna,
					zipCode: place.zip,
					location: {
						x: place.lng + jitter(n, k, 0.002),
						y: place.lat + jitter(n, k + 5, 0.002),
					},
					isDefault: k === 0,
				});
			}
		} else if (n % SHOWCASE_ADDRESS_EVERY === 0) {
			const handle = pick(showcaseHandles, n / SHOWCASE_ADDRESS_EVERY);
			const { lat, lng, zip } = SEED_MUNICIPALITY_COORDS[handle];
			rows.push({
				customerProfileId,
				label: "Casa",
				addressLine1: `${pick(streets, n, 3)} ${5 + (n % 60)}`,
				municipalityId: municipalityIds[handle],
				zipCode: zip,
				location: {
					x: lng + jitter(n, 1, 0.01),
					y: lat + jitter(n, 2, 0.01),
				},
				isDefault: true,
			});
		}
	}

	await db.insert(customerAddress).values(rows);
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
				.set({
					role: "customer",
					emailVerified: true,
					firstName: c.firstName,
					lastName: c.lastName,
					birthDate: c.birthDate,
				})
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
			userId: customerProfile.userId,
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

	await seedAddresses(profiles, created);

	console.log(
		`  ✓ ${created.length} customers seeded (${withPoints.length} with points)`,
	);
}
