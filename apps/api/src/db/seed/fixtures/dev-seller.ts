import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { organization } from "@/db/schemas/organization";
import { pricingConfig } from "@/db/schemas/pricing-config";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { auth } from "@/lib/auth";

const DEV_EMAIL = "seller@dev.bibs";
const DEV_PASSWORD = "password123";

/**
 * Fixed dev seller for E2E smoke tests. Active, owns 2 stores both with active
 * subscriptions. Use this account when you want to skip the signup + verify
 * onboarding flow and land directly on a populated /billing page.
 *
 * Credentials: seller@dev.bibs / password123
 */
export async function seedDevSeller() {
	const existing = await db.query.user.findFirst({
		where: eq(user.email, DEV_EMAIL),
	});
	if (existing) {
		console.log(`  ⏭ Dev seller (${DEV_EMAIL}) already seeded, skipping`);
		return;
	}

	const activePricing = await db.query.pricingConfig.findFirst({
		where: eq(pricingConfig.isActive, true),
	});
	if (!activePricing) {
		console.warn(
			"  ⚠️ No active pricing_config — dev seller will have stores but no subscriptions.",
		);
	}

	console.log(`  👤 Seeding dev seller ${DEV_EMAIL}...`);

	// Phase 1: auth user
	const { user: u } = await auth.api.signUpEmail({
		body: { name: "Dev Seller", email: DEV_EMAIL, password: DEV_PASSWORD },
	});
	await db
		.update(user)
		.set({
			role: "seller",
			emailVerified: true,
			firstName: "Dev",
			lastName: "Seller",
			birthDate: "1985-06-15",
		})
		.where(eq(user.id, u.id));

	// Phase 2: seller_profile (active, with fake stripeCustomerId)
	const stripeCustomerId = `cus_seed_dev_${u.id.slice(0, 12)}`;
	const [profile] = await db
		.insert(sellerProfile)
		.values({
			userId: u.id,
			onboardingStatus: "active",
			stripeCustomerId,
			firstName: "Dev",
			lastName: "Seller",
			citizenship: "IT",
			birthCountry: "IT",
			birthDate: "1985-06-15",
			residenceCountry: "IT",
			residenceCity: "Milano",
			residenceAddress: "Via Dev 1",
			residenceZipCode: "20121",
			documentNumber: "AX0000001",
			documentExpiry: "2030-12-31",
			documentIssuedMunicipality: "Milano",
		})
		.returning({ id: sellerProfile.id });

	// Phase 3: organization (verified VAT)
	await db.insert(organization).values({
		sellerProfileId: profile.id,
		businessName: "Dev Seller SRL",
		vatNumber: "12345678901",
		legalForm: "SRL",
		addressLine1: "Via Dev 1",
		city: "Milano",
		zipCode: "20121",
		province: "MI",
		vatStatus: "verified",
	});

	// Phase 4: two stores
	const insertedStores = await db
		.insert(store)
		.values([
			{
				sellerProfileId: profile.id,
				name: "Bottega Dev",
				description: "Negozio principale per smoke test",
				addressLine1: "Via Dev 1",
				city: "Milano",
				zipCode: "20121",
				province: "MI",
				location: { x: 9.18814, y: 45.46796 },
			},
			{
				sellerProfileId: profile.id,
				name: "Bottega Dev Centro",
				description: "Secondo punto vendita per testare multi-store",
				addressLine1: "Via Dev 42",
				city: "Milano",
				zipCode: "20122",
				province: "MI",
				location: { x: 9.19014, y: 45.46426 },
			},
		])
		.returning({ id: store.id });

	// Phase 5: two active subscriptions (only if pricing is available)
	if (activePricing) {
		const now = Date.now();
		await db.insert(storeSubscription).values(
			insertedStores.map((s, idx) => ({
				storeId: s.id,
				stripeSubscriptionId: `sub_seed_dev_${s.id.slice(0, 12)}_${idx}`,
				stripeCustomerId,
				stripePriceId: activePricing.stripePriceId,
				feeAmountCents: activePricing.storeMonthlyFeeCents,
				currency: activePricing.currency,
				status: "active" as const,
				currentPeriodEnd: new Date(now + 30 * 86400000),
				cancelAtPeriodEnd: false,
			})),
		);
	}

	console.log(`  ✓ Dev seller seeded — login: ${DEV_EMAIL} / ${DEV_PASSWORD}`);
}
