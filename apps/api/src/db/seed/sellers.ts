import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import type { VatStatus } from "@/db/schemas/organization";
import { organization } from "@/db/schemas/organization";
import { paymentMethod } from "@/db/schemas/payment-method";
import type { OnboardingStatus } from "@/db/schemas/seller";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { auth } from "@/lib/auth";
import { cities, firstNames, lastNames, pick, streets } from "./utils";

// ── Legal forms ───────────────────────────────────────────

const legalForms = [
	"SRL",
	"SRLS",
	"SAS",
	"SNC",
	"Ditta Individuale",
	"Cooperativa",
];

// ── Business types & store names ──────────────────────────

const businessPrefixes = [
	"Alimentari",
	"Panificio",
	"Pasticceria",
	"Macelleria",
	"Enoteca",
	"Ristorante",
	"Trattoria",
	"Boutique",
	"Gioielleria",
	"Libreria",
	"Erboristeria",
	"Fiorista",
	"Ferramenta",
	"Ceramiche",
	"Pelletteria",
	"Gelateria",
	"Pizzeria",
	"Osteria",
	"Caffetteria",
	"Sartoria",
	"Ottica",
	"Profumeria",
	"Cartoleria",
	"Vivaio",
	"Gastronomia",
];

function makeStoreName(prefix: string, lastName: string, idx: number): string {
	const patterns = [
		`${prefix} ${lastName}`,
		`${prefix} del Centro`,
		`La Bottega di ${lastName}`,
		`${prefix} del Corso`,
		`Da ${lastName}`,
		`${prefix} di ${lastName}`,
		`Casa ${lastName}`,
		`${prefix} del Borgo`,
	];
	return patterns[idx % patterns.length];
}

const storeDescriptions = [
	"Prodotti artigianali di alta qualità dal cuore della tradizione italiana",
	"Specialità locali selezionate con cura per i nostri clienti",
	"Da tre generazioni al servizio della comunità con passione e dedizione",
	"Il meglio del territorio a portata di mano, ogni giorno",
	"Qualità, freschezza e tradizione in ogni prodotto",
	"Prodotti genuini della nostra terra, dal produttore al consumatore",
	"L'eccellenza artigianale italiana nel cuore della città",
	"Sapori autentici e ricette della tradizione",
	"Il punto di riferimento per chi cerca qualità e cortesia",
	"Passione e competenza al servizio dei nostri clienti dal 1985",
	"Selezione accurata di prodotti tipici del territorio",
	"Dove la tradizione incontra l'innovazione",
	"Prodotti freschi e genuini, scelti con cura ogni giorno",
	"Un angolo di gusto e tradizione nel centro della città",
	"La qualità che fa la differenza, da oltre vent'anni",
];

// ── Onboarding stage helpers ──────────────────────────────

const stageOrder: readonly OnboardingStatus[] = [
	"pending_email",
	"pending_personal",
	"pending_document",
	"pending_company",
	"pending_store",
	"pending_payment",
	"pending_review",
	"active",
];

function getStageIndex(status: OnboardingStatus): number {
	if (status === "rejected") return 6; // rejected = same data as pending_review
	return stageOrder.indexOf(status);
}

// ── Types ─────────────────────────────────────────────────

export interface SellerSeedData {
	email: string;
	name: string;
	onboardingStatus: OnboardingStatus;
	vatNumber: string;
	vatStatus: VatStatus;
	profileFields: {
		firstName: string | null;
		lastName: string | null;
		citizenship: string | null;
		birthCountry: string | null;
		birthDate: string | null;
		residenceCountry: string | null;
		residenceCity: string | null;
		residenceAddress: string | null;
		residenceZipCode: string | null;
		documentNumber: string | null;
		documentExpiry: string | null;
		documentIssuedMunicipality: string | null;
	};
	org: {
		businessName: string;
		legalForm: string;
		addressLine1: string;
		city: string;
		zipCode: string;
		province: string;
	};
	store: {
		name: string;
		description: string;
		addressLine1: string;
		city: string;
		zipCode: string;
		province: string;
		lat: number;
		lng: number;
	} | null;
	hasPayment: boolean;
}

// ── Status distribution (150 sellers total) ───────────────

interface StatusConfig {
	status: OnboardingStatus;
	count: number;
	vatStatus: VatStatus;
}

const statusDistribution: readonly StatusConfig[] = [
	{ status: "active", count: 55, vatStatus: "verified" },
	{ status: "pending_review", count: 25, vatStatus: "pending" },
	{ status: "pending_payment", count: 15, vatStatus: "pending" },
	{ status: "pending_store", count: 12, vatStatus: "pending" },
	{ status: "pending_company", count: 10, vatStatus: "pending" },
	{ status: "pending_document", count: 10, vatStatus: "pending" },
	{ status: "pending_personal", count: 8, vatStatus: "pending" },
	{ status: "pending_email", count: 8, vatStatus: "pending" },
	{ status: "rejected", count: 7, vatStatus: "rejected" },
];

// ── Generator ─────────────────────────────────────────────

function generateSellersSeedData(): SellerSeedData[] {
	const sellers: SellerSeedData[] = [];
	let idx = 0;

	for (const config of statusDistribution) {
		for (let i = 0; i < config.count; i++) {
			const firstName = pick(firstNames, idx, 1);
			const lastName = pick(lastNames, idx, 3, 7);
			const residenceCity = pick(cities, idx, 2, 5);
			const orgCity = pick(cities, idx, 3, 11);
			const storeCity = pick(cities, idx, 5, 3);
			const street = pick(streets, idx, 7, 13);
			const orgStreet = pick(streets, idx, 11, 17);
			const storeStreet = pick(streets, idx, 13, 19);
			const legalForm = pick(legalForms, idx, 1, 2);
			const businessPrefix = pick(businessPrefixes, idx, 1);
			const storeDesc = pick(storeDescriptions, idx, 1, 3);

			const stage = getStageIndex(config.status);
			const streetNum = (idx % 120) + 1;
			const vatNumber = (20000000001 + idx).toString();

			// Deterministic birth date: 1960–1994
			const year = 1960 + (idx % 35);
			const month = (idx % 12) + 1;
			const day = (idx % 28) + 1;
			const birthDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

			// Document expiry: 2028–2032
			const expiryYear = 2028 + (idx % 5);
			const documentExpiry = `${expiryYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

			const hasPersonal = stage >= 2;
			const hasDocument = stage >= 3;
			const hasStore = stage >= 5;
			const hasPayment = stage >= 6;

			const businessName =
				legalForm === "Ditta Individuale"
					? `${firstName} ${lastName}`
					: legalForm === "Cooperativa"
						? `Cooperativa ${businessPrefix} ${lastName}`
						: `${businessPrefix} ${lastName}`;

			sellers.push({
				email: `seller${idx + 1}@test.com`,
				name: `${firstName} ${lastName}`,
				onboardingStatus: config.status,
				vatNumber,
				vatStatus: config.vatStatus,
				profileFields: {
					firstName: hasPersonal ? firstName : null,
					lastName: hasPersonal ? lastName : null,
					citizenship: hasPersonal ? "IT" : null,
					birthCountry: hasPersonal ? "IT" : null,
					birthDate: hasPersonal ? birthDate : null,
					residenceCountry: hasPersonal ? "IT" : null,
					residenceCity: hasPersonal ? residenceCity.name : null,
					residenceAddress: hasPersonal ? `${street}, ${streetNum}` : null,
					residenceZipCode: hasPersonal ? residenceCity.zip : null,
					documentNumber: hasDocument
						? `AX${String(idx + 1).padStart(7, "0")}`
						: null,
					documentExpiry: hasDocument ? documentExpiry : null,
					documentIssuedMunicipality: hasDocument ? residenceCity.name : null,
				},
				org: {
					businessName,
					legalForm,
					addressLine1: `${orgStreet}, ${(idx % 200) + 1}`,
					city: orgCity.name,
					zipCode: orgCity.zip,
					province: orgCity.province,
				},
				store: hasStore
					? {
							name: makeStoreName(businessPrefix, lastName, idx),
							description: storeDesc,
							addressLine1: `${storeStreet}, ${(idx % 150) + 1}`,
							city: storeCity.name,
							zipCode: storeCity.zip,
							province: storeCity.province,
							lat: storeCity.lat + (idx % 10) * 0.001,
							lng: storeCity.lng + (idx % 7) * 0.001,
						}
					: null,
				hasPayment,
			});

			idx++;
		}
	}

	return sellers;
}

// ── Seeding function ──────────────────────────────────────

export async function seedSellers() {
	const existing = await db.query.user.findFirst({
		where: eq(user.email, "seller1@test.com"),
	});
	if (existing) {
		console.log("  ⏭ Bulk sellers already seeded, skipping");
		return;
	}

	const sellersData = generateSellersSeedData();
	console.log(`  👥 Seeding ${sellersData.length} sellers...`);

	// Phase 1: Create users via auth (sequential — password hashing)
	const created: Array<{ userId: string; data: SellerSeedData }> = [];
	for (let i = 0; i < sellersData.length; i++) {
		const s = sellersData[i];
		try {
			const { user: u } = await auth.api.signUpEmail({
				body: { name: s.name, email: s.email, password: "password123" },
			});
			await db
				.update(user)
				.set({ role: "seller", emailVerified: true })
				.where(eq(user.id, u.id));
			created.push({ userId: u.id, data: s });
		} catch {
			console.error(`     ✗ Failed: ${s.email}`);
		}
		if ((i + 1) % 25 === 0) {
			console.log(`     ... ${i + 1}/${sellersData.length} users`);
		}
	}

	if (created.length === 0) return;

	// Phase 2: Batch insert seller profiles
	const profiles = await db
		.insert(sellerProfile)
		.values(
			created.map(({ userId, data }) => ({
				userId,
				onboardingStatus: data.onboardingStatus,
				...data.profileFields,
			})),
		)
		.returning({ id: sellerProfile.id });

	// Phase 3: Batch insert organizations
	await db.insert(organization).values(
		created.map(({ data }, i) => ({
			sellerProfileId: profiles[i].id,
			businessName: data.org.businessName,
			vatNumber: data.vatNumber,
			legalForm: data.org.legalForm,
			addressLine1: data.org.addressLine1,
			city: data.org.city,
			zipCode: data.org.zipCode,
			province: data.org.province,
			vatStatus: data.vatStatus,
		})),
	);

	// Phase 4: Batch insert stores (for sellers at pending_payment+)
	const storeEntries = created
		.map(({ data }, i) =>
			data.store
				? {
						sellerProfileId: profiles[i].id,
						name: data.store.name,
						description: data.store.description,
						addressLine1: data.store.addressLine1,
						city: data.store.city,
						zipCode: data.store.zipCode,
						province: data.store.province,
						location: { x: data.store.lng, y: data.store.lat },
					}
				: null,
		)
		.filter((e): e is NonNullable<typeof e> => e !== null);

	if (storeEntries.length > 0) {
		await db.insert(store).values(storeEntries);
	}

	// Phase 5: Batch insert payment methods (for sellers at pending_review+)
	const paymentEntries = created
		.map(({ data }, i) =>
			data.hasPayment
				? {
						sellerProfileId: profiles[i].id,
						stripeAccountId: `acct_test_${profiles[i].id.slice(0, 8)}`,
					}
				: null,
		)
		.filter((e): e is NonNullable<typeof e> => e !== null);

	if (paymentEntries.length > 0) {
		await db.insert(paymentMethod).values(paymentEntries);
	}

	console.log(`  ✓ ${created.length} sellers seeded`);
}
