import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";

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

import { eq } from "drizzle-orm";
import { store } from "@/db/schemas/store";
import { getStoreDetail } from "@/modules/customer/services/store-detail";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestSeller,
	createTestStore,
	createTestStoreCategory,
	createTestStoreImage,
	createTestStorePhoneNumber,
	createTestStoreSubscription,
} from "../helpers/fixtures";

const ROME = { lat: 41.9028, lng: 12.4964 };

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

async function visibleStore(
	sellerProfileId: string,
	params: Parameters<typeof createTestStore>[2] = {},
) {
	const db = getTestDb();
	const s = await createTestStore(db, sellerProfileId, params);
	await createTestStoreSubscription(db, s.id, { status: "active" });
	return s;
}

describe("getStoreDetail — visible store", () => {
	it("returns the full detail DTO", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const cat = await createTestStoreCategory(db, "Libreria");
		const s = await visibleStore(profile.id, {
			name: "La Libreria",
			categoryId: cat.id,
			...ROME,
			openingHours: [
				{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }] },
			],
		});
		await createTestStoreImage(db, s.id, {
			url: "https://img.test/b.jpg",
			position: 2,
		});
		await createTestStoreImage(db, s.id, {
			url: "https://img.test/a.jpg",
			position: 0,
		});
		await createTestStorePhoneNumber(db, s.id, {
			label: "Negozio",
			number: "065551234",
			position: 1,
		});
		await createTestStorePhoneNumber(db, s.id, {
			label: null,
			number: "060000000",
			position: 0,
		});

		const detail = await getStoreDetail(s.id);

		expect(detail.name).toBe("La Libreria");
		expect(detail.category).toEqual({ id: cat.id, name: "Libreria" });
		expect(detail.municipality.provinceAcronym).toHaveLength(2);
		expect(detail.addressLine1).toBe("Via Roma 1");
		// images ordered by position
		expect(detail.images.map((i) => i.url)).toEqual([
			"https://img.test/a.jpg",
			"https://img.test/b.jpg",
		]);
		// phones ordered by position
		expect(detail.phoneNumbers.map((p) => p.number)).toEqual([
			"060000000",
			"065551234",
		]);
		// coordinates: lat=y, lng=x
		expect(detail.coordinates).not.toBeNull();
		expect(detail.coordinates?.lat).toBeCloseTo(ROME.lat, 3);
		expect(detail.coordinates?.lng).toBeCloseTo(ROME.lng, 3);
		expect(detail.openStatus).toBeDefined();
		expect(detail.openingHours).toEqual([
			{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }] },
		]);
	});

	it("returns null coordinates when the store has no location", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id, {
			name: "SenzaPosizione",
			noLocation: true,
		});
		const detail = await getStoreDetail(s.id);
		expect(detail.coordinates).toBeNull();
	});
});

describe("getStoreDetail — visibility (404)", () => {
	it("404 for a non-existent id", async () => {
		await expect(getStoreDetail("does-not-exist")).rejects.toThrow(
			"Negozio non trovato",
		);
	});

	it("404 for a store with no subscription", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await createTestStore(db, profile.id, {
			name: "SenzaAbbonamento",
		});
		await expect(getStoreDetail(s.id)).rejects.toThrow("Negozio non trovato");
	});

	it("404 for suspended and canceled subscriptions", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const suspended = await createTestStore(db, profile.id, {
			name: "Sospeso",
		});
		await createTestStoreSubscription(db, suspended.id, {
			status: "suspended",
		});
		const canceled = await createTestStore(db, profile.id, {
			name: "Cancellato",
		});
		await createTestStoreSubscription(db, canceled.id, { status: "canceled" });
		await expect(getStoreDetail(suspended.id)).rejects.toThrow(
			"Negozio non trovato",
		);
		await expect(getStoreDetail(canceled.id)).rejects.toThrow(
			"Negozio non trovato",
		);
	});

	it("404 for a soft-deleted store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const s = await visibleStore(profile.id, { name: "Eliminato" });
		await db
			.update(store)
			.set({ deletedAt: new Date() })
			.where(eq(store.id, s.id));
		await expect(getStoreDetail(s.id)).rejects.toThrow("Negozio non trovato");
	});
});
