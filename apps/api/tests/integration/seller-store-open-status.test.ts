import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { eq } from "drizzle-orm";
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

const { listStores } = await import("@/modules/seller/services/stores");
const { store: storeTable } = await import("@/db/schemas/store");
const { createTestSeller, createTestStore } = await import(
	"../helpers/fixtures"
);
const { truncateAll } = await import("../helpers/cleanup");

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("listStores openStatus", () => {
	it("includes an openStatus object for each store", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		// Open every day 00:00-23:59 so the store is unambiguously open now.
		await db
			.update(storeTable)
			.set({
				openingHours: Array.from({ length: 7 }, (_, i) => ({
					dayOfWeek: i,
					slots: [{ open: "00:00", close: "23:59" }],
				})),
			})
			.where(eq(storeTable.id, store.id));

		const result = await listStores({ sellerProfileId: profile.id });
		expect(result.data).toHaveLength(1);
		expect(result.data[0].openStatus?.isOpen).toBe(true);
		expect(result.data[0].openStatus?.status).toBe("open");
	});

	it("openStatus.status is closed when openingHours is null", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		await createTestStore(db, profile.id); // no openingHours set
		const result = await listStores({ sellerProfileId: profile.id });
		expect(result.data[0].openStatus?.isOpen).toBe(false);
		expect(result.data[0].openStatus?.status).toBe("closed");
	});
});
