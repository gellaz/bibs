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
import { product } from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { searchProducts } from "@/modules/customer/services/search";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("searchProducts — excludes soft-deleted stores", () => {
	it("does not return a product stocked only in a soft-deleted store (no geo)", async () => {
		const db = getTestDb();
		const { profile: seller } = await createTestSeller(db);
		const storeActive = await createTestStore(db, seller.id, {
			name: "Active",
		});
		const storeDeleted = await createTestStore(db, seller.id, {
			name: "Deleted",
		});
		await db
			.update(store)
			.set({ deletedAt: new Date() })
			.where(eq(store.id, storeDeleted.id));

		const visible = await createTestProduct(db, seller.id, {
			name: "Visibile",
		});
		const hidden = await createTestProduct(db, seller.id, { name: "Nascosto" });
		await createTestStoreProduct(db, storeActive.id, visible.id, { stock: 5 });
		await createTestStoreProduct(db, storeDeleted.id, hidden.id, { stock: 5 });

		const res = await searchProducts({});
		const ids = res.data.map((r) => r.id);

		expect(ids).toContain(visible.id);
		expect(ids).not.toContain(hidden.id);
		expect(res.pagination.total).toBe(1);
	});

	it("does not return a product stocked only in a soft-deleted store (geo)", async () => {
		const db = getTestDb();
		const { profile: seller } = await createTestSeller(db);
		// Store near the search point but soft-deleted.
		const storeDeleted = await createTestStore(db, seller.id, {
			lat: 41.9028,
			lng: 12.4964,
		});
		await db
			.update(store)
			.set({ deletedAt: new Date() })
			.where(eq(store.id, storeDeleted.id));

		const hidden = await createTestProduct(db, seller.id, { name: "Nascosto" });
		await createTestStoreProduct(db, storeDeleted.id, hidden.id, { stock: 5 });

		const res = await searchProducts({
			lat: 41.9028,
			lng: 12.4964,
			radius: 50,
		});
		expect(res.data.map((r) => r.id)).not.toContain(hidden.id);
		expect(res.pagination.total).toBe(0);
	});
});

describe("searchProducts — stable ordering", () => {
	it("orders newest-first with a deterministic tiebreaker when no q/geo", async () => {
		const db = getTestDb();
		const { profile: seller } = await createTestSeller(db);
		const storeActive = await createTestStore(db, seller.id);

		const p1 = await createTestProduct(db, seller.id, { name: "Uno" });
		const p2 = await createTestProduct(db, seller.id, { name: "Due" });
		const p3 = await createTestProduct(db, seller.id, { name: "Tre" });
		for (const p of [p1, p2, p3]) {
			await createTestStoreProduct(db, storeActive.id, p.id, { stock: 5 });
		}

		// All distances are 0 (no geo) → ordering must fall back to a stable
		// tiebreaker. Give distinct createdAt so we can assert newest-first.
		await db
			.update(product)
			.set({ createdAt: new Date("2025-01-01T00:00:00Z") })
			.where(eq(product.id, p1.id));
		await db
			.update(product)
			.set({ createdAt: new Date("2025-02-01T00:00:00Z") })
			.where(eq(product.id, p2.id));
		await db
			.update(product)
			.set({ createdAt: new Date("2025-03-01T00:00:00Z") })
			.where(eq(product.id, p3.id));

		const res = await searchProducts({});
		expect(res.data.map((r) => r.id)).toEqual([p3.id, p2.id, p1.id]);
	});
});
