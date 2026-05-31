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

const { getStoreClosures, putStoreClosures } = await import(
	"@/modules/seller/services/closures"
);
const { holidayDefinition } = await import("@/db/schemas/holiday-definition");
const { createTestSeller, createTestStore } = await import(
	"../helpers/fixtures"
);
const { truncateAll } = await import("../helpers/cleanup");

async function seedDef(
	name: string,
	month: number,
	day: number,
): Promise<string> {
	const [d] = await getTestDb()
		.insert(holidayDefinition)
		.values({ name, type: "fixed", month, day })
		.returning({ id: holidayDefinition.id });
	return d.id;
}

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("seller closures service", () => {
	it("observes all active holidays by default", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		await seedDef("Natale", 12, 25);

		const res = await getStoreClosures(store.id, profile.id);
		expect(res.holidays).toHaveLength(1);
		expect(res.holidays[0].observed).toBe(true);
		expect(res.customClosures).toEqual([]);
	});

	it("PUT replaces opt-outs and custom closures (wholesale)", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		const natale = await seedDef("Natale", 12, 25);

		const res = await putStoreClosures({
			storeId: store.id,
			sellerProfileId: profile.id,
			optOutIds: [natale],
			customClosures: [
				{ startDate: "2026-08-10", endDate: "2026-08-20", note: "Ferie" },
			],
		});

		expect(res.holidays[0].observed).toBe(false);
		expect(res.customClosures).toHaveLength(1);
		expect(res.customClosures[0].note).toBe("Ferie");

		// Re-PUT with empty sets clears everything.
		const cleared = await putStoreClosures({
			storeId: store.id,
			sellerProfileId: profile.id,
			optOutIds: [],
			customClosures: [],
		});
		expect(cleared.holidays[0].observed).toBe(true);
		expect(cleared.customClosures).toEqual([]);
	});

	it("rejects an invalid range with 400", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		await expect(
			putStoreClosures({
				storeId: store.id,
				sellerProfileId: profile.id,
				optOutIds: [],
				customClosures: [{ startDate: "2026-08-20", endDate: "2026-08-10" }],
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("rejects unknown optOut ids with 400", async () => {
		const db = getTestDb();
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		await expect(
			putStoreClosures({
				storeId: store.id,
				sellerProfileId: profile.id,
				optOutIds: ["does-not-exist"],
				customClosures: [],
			}),
		).rejects.toMatchObject({ status: 400 });
	});

	it("404 when the store belongs to another seller", async () => {
		const db = getTestDb();
		const a = await createTestSeller(db);
		const b = await createTestSeller(db, { email: "b@test.com" });
		const storeB = await createTestStore(db, b.profile.id);
		await expect(
			getStoreClosures(storeB.id, a.profile.id),
		).rejects.toMatchObject({ status: 404 });
	});
});
