import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

// ── Imports (resolved after mocks) ────────────────────────────────────────────

import { eq } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import type { StoreSubscriptionStatus } from "@/db/schemas/store-subscription";
import { adminStoreStatuses } from "@/lib/queries";
import {
	countStoresByStatus,
	listStores,
} from "@/modules/admin/services/stores";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestMunicipality,
	createTestOrganization,
	createTestSeller,
	createTestStore,
	createTestStoreCategory,
	createTestStoreSubscription,
} from "../helpers/fixtures";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

/**
 * Rossi SRL (Bologna): un negozio per stato di abbonamento + uno senza + uno
 * eliminato. Bianchi SNC (Modena): «Bottega», senza abbonamento. Un venditore
 * senza organization: «Orfano».
 */
async function seed() {
	const db = getTestDb();
	const bologna = await createTestMunicipality(db, {
		municipalityName: "Bologna",
		provinceName: "Bologna",
		provinceAcronym: "BO",
	});
	const modena = await createTestMunicipality(db, {
		municipalityName: "Modena",
		provinceName: "Modena",
		provinceAcronym: "MO",
	});
	const alimentari = await createTestStoreCategory(db, "Alimentari");

	const rossi = await createTestSeller(db);
	await createTestOrganization(db, rossi.profile.id, {
		businessName: "Rossi SRL",
	});
	const atRossi = async (
		name: string,
		status?: StoreSubscriptionStatus,
		categoryId?: string,
	) => {
		const s = await createTestStore(db, rossi.profile.id, {
			name,
			municipalityId: bologna.id,
			categoryId,
		});
		if (status) await createTestStoreSubscription(db, s.id, { status });
		return s;
	};

	await atRossi("Attivo", "active", alimentari.id);
	await atRossi("In cancellazione", "canceling");
	await atRossi("Insoluto", "past_due");
	await atRossi("Sospeso", "suspended");
	await atRossi("Cancellato", "canceled");
	await atRossi("Senza");
	const eliminato = await atRossi("Eliminato", "active");
	await db
		.update(store)
		.set({ deletedAt: new Date() })
		.where(eq(store.id, eliminato.id));

	const bianchi = await createTestSeller(db);
	await createTestOrganization(db, bianchi.profile.id, {
		businessName: "Bianchi SNC",
	});
	await createTestStore(db, bianchi.profile.id, {
		name: "Bottega",
		municipalityId: modena.id,
	});

	const orfano = await createTestSeller(db);
	await createTestStore(db, orfano.profile.id, {
		name: "Orfano",
		municipalityId: bologna.id,
	});
}

const names = async (params: Parameters<typeof listStores>[0]) =>
	(await listStores({ limit: 100, ...params })).data.map((s) => s.name).sort();

describe("listStores — tab", () => {
	it("all: solo negozi vivi", async () => {
		await seed();
		expect(await names({})).toEqual([
			"Attivo",
			"Bottega",
			"Cancellato",
			"In cancellazione",
			"Insoluto",
			"Orfano",
			"Senza",
			"Sospeso",
		]);
	});

	it("active: attivo e in cancellazione, non l'eliminato con abbonamento attivo", async () => {
		await seed();
		expect(await names({ status: "active" })).toEqual([
			"Attivo",
			"In cancellazione",
		]);
	});

	it("past_due e suspended", async () => {
		await seed();
		expect(await names({ status: "past_due" })).toEqual(["Insoluto"]);
		expect(await names({ status: "suspended" })).toEqual(["Sospeso"]);
	});

	it("none: senza abbonamento o cancellato", async () => {
		await seed();
		expect(await names({ status: "none" })).toEqual([
			"Bottega",
			"Cancellato",
			"Orfano",
			"Senza",
		]);
	});

	it("deleted: solo gli eliminati, con la data", async () => {
		await seed();
		const { data } = await listStores({ status: "deleted" });
		expect(data.map((s) => s.name)).toEqual(["Eliminato"]);
		expect(data[0].deletedAt).toBeInstanceOf(Date);
	});
});

describe("listStores — riga", () => {
	it("venditore, categoria, comune e abbonamento", async () => {
		await seed();
		const { data } = await listStores({ search: "Attivo" });
		expect(data[0]).toMatchObject({
			name: "Attivo",
			businessName: "Rossi SRL",
			categoryName: "Alimentari",
			municipality: { name: "Bologna", provinceAcronym: "BO" },
			subscriptionStatus: "active",
			deletedAt: null,
		});
	});

	it("senza organization e senza categoria: c'è, con null", async () => {
		await seed();
		const { data } = await listStores({ search: "Orfano" });
		expect(data).toHaveLength(1);
		expect(data[0]).toMatchObject({
			businessName: null,
			categoryName: null,
			subscriptionStatus: null,
		});
	});
});

describe("listStores — ricerca e ordinamento", () => {
	it("cerca su nome negozio, ragione sociale e comune", async () => {
		await seed();
		expect(await names({ search: "bott" })).toEqual(["Bottega"]);
		expect(await names({ search: "bianchi" })).toEqual(["Bottega"]);
		expect(await names({ search: "moden" })).toEqual(["Bottega"]);
	});

	it("% e _ sono letterali", async () => {
		await seed();
		expect(await names({ search: "%" })).toEqual([]);
		expect(await names({ search: "_" })).toEqual([]);
	});

	it("ordina per nome", async () => {
		await seed();
		const { data } = await listStores({
			status: "none",
			sortBy: "name",
			sortOrder: "asc",
		});
		expect(data.map((s) => s.name)).toEqual([
			"Bottega",
			"Cancellato",
			"Orfano",
			"Senza",
		]);
	});

	it("pagina", async () => {
		await seed();
		const page2 = await listStores({
			page: 2,
			limit: 3,
			sortBy: "name",
			sortOrder: "asc",
		});
		expect(page2.pagination).toEqual({ page: 2, limit: 3, total: 8 });
		expect(page2.data.map((s) => s.name)).toEqual([
			"In cancellazione",
			"Insoluto",
			"Orfano",
		]);
	});
});

describe("countStoresByStatus", () => {
	it("coincide con il totale della lista per ogni tab", async () => {
		await seed();
		const counts = await countStoresByStatus();
		expect(counts).toEqual({
			all: 8,
			active: 2,
			past_due: 1,
			suspended: 1,
			none: 4,
			deleted: 1,
		});
		for (const status of adminStoreStatuses) {
			const { pagination } = await listStores({ status });
			expect(counts[status]).toBe(pagination.total);
		}
	});
});
