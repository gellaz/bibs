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

import { eq, isNull } from "drizzle-orm";
import { store as storeTable } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import {
	createStore,
	deleteStore,
	listStores,
	updateStore,
} from "@/modules/seller/services/stores";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

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

// ── listStores ────────────────────────────────────────────────────────────────

describe("listStores", () => {
	it("returns empty list when seller has no stores", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const result = await listStores({ sellerProfileId: seller.profile.id });

		expect(result.data).toHaveLength(0);
		expect(result.pagination.total).toBe(0);
	});

	it("returns only the seller's non-deleted stores", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });

		await createStore({
			sellerProfileId: sellerA.profile.id,
			name: "A1",
			addressLine1: "Via A",
			city: "Milano",
			zipCode: "20100",
		});
		await createStore({
			sellerProfileId: sellerA.profile.id,
			name: "A2",
			addressLine1: "Via A2",
			city: "Milano",
			zipCode: "20101",
		});
		await createStore({
			sellerProfileId: sellerB.profile.id,
			name: "B1",
			addressLine1: "Via B",
			city: "Roma",
			zipCode: "00100",
		});

		const result = await listStores({ sellerProfileId: sellerA.profile.id });

		expect(result.data).toHaveLength(2);
		expect(
			result.data.every((s) => s.sellerProfileId === sellerA.profile.id),
		).toBe(true);
	});

	it("excludes soft-deleted stores", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s1 = await createStore({
			sellerProfileId: seller.profile.id,
			name: "Keep",
			addressLine1: "Via",
			city: "Roma",
			zipCode: "00100",
		});
		await createStore({
			sellerProfileId: seller.profile.id,
			name: "Delete",
			addressLine1: "Via",
			city: "Roma",
			zipCode: "00101",
		});

		// Soft-delete via service
		const result0 = await listStores({ sellerProfileId: seller.profile.id });
		expect(result0.data).toHaveLength(2);

		const toDelete = result0.data.find((s) => s.name === "Delete");
		expect(toDelete).toBeDefined();
		await deleteStore({
			storeId: toDelete!.id,
			sellerProfileId: seller.profile.id,
		});

		const result = await listStores({ sellerProfileId: seller.profile.id });
		expect(result.data).toHaveLength(1);
		expect(result.data[0].id).toBe(s1.id);
	});
});

// ── createStore ───────────────────────────────────────────────────────────────

describe("createStore", () => {
	it("creates a store with phone numbers", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const created = await createStore({
			sellerProfileId: seller.profile.id,
			name: "Negozio",
			addressLine1: "Via Dante 1",
			city: "Milano",
			zipCode: "20121",
			phoneNumbers: [
				{ label: "Principale", number: "0212345678" },
				{ number: "3331234567" },
			],
		});

		expect(created.name).toBe("Negozio");
		expect(created.phoneNumbers).toHaveLength(2);
	});

	it("creates a store without optional fields", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const created = await createStore({
			sellerProfileId: seller.profile.id,
			name: "Basic",
			addressLine1: "Via 1",
			city: "Roma",
			zipCode: "00100",
		});

		expect(created.phoneNumbers).toEqual([]);
	});
});

// ── updateStore ───────────────────────────────────────────────────────────────

describe("updateStore", () => {
	it("updates name and address", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const created = await createStore({
			sellerProfileId: seller.profile.id,
			name: "Old",
			addressLine1: "Via Vecchia",
			city: "Roma",
			zipCode: "00100",
		});

		const updated = await updateStore({
			storeId: created.id,
			sellerProfileId: seller.profile.id,
			name: "New",
			addressLine1: "Via Nuova",
		});

		expect(updated.name).toBe("New");
		expect(updated.addressLine1).toBe("Via Nuova");
	});

	it("replaces phone numbers when phoneNumbers is provided", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const created = await createStore({
			sellerProfileId: seller.profile.id,
			name: "S",
			addressLine1: "Via",
			city: "Roma",
			zipCode: "00100",
			phoneNumbers: [{ number: "111111111" }, { number: "222222222" }],
		});

		const updated = await updateStore({
			storeId: created.id,
			sellerProfileId: seller.profile.id,
			phoneNumbers: [{ number: "333333333" }],
		});

		expect(updated.phoneNumbers).toHaveLength(1);
		expect(updated.phoneNumbers[0].number).toBe("333333333");
	});

	it("throws ServiceError 404 when store does not belong to seller", async () => {
		const db = getTestDb();
		const owner = await createTestSeller(db, { email: "owner@test.com" });
		const other = await createTestSeller(db, { email: "other@test.com" });
		const created = await createStore({
			sellerProfileId: owner.profile.id,
			name: "S",
			addressLine1: "Via",
			city: "Roma",
			zipCode: "00100",
		});

		await expect(
			updateStore({
				storeId: created.id,
				sellerProfileId: other.profile.id,
				name: "Hacked",
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

// ── deleteStore ───────────────────────────────────────────────────────────────

describe("deleteStore", () => {
	it("soft-deletes the store (sets deletedAt)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const created = await createStore({
			sellerProfileId: seller.profile.id,
			name: "S",
			addressLine1: "Via",
			city: "Roma",
			zipCode: "00100",
		});

		await deleteStore({
			storeId: created.id,
			sellerProfileId: seller.profile.id,
		});

		const [row] = await db
			.select()
			.from(storeTable)
			.where(eq(storeTable.id, created.id));
		expect(row.deletedAt).not.toBeNull();

		// Still queryable via direct DB, but excluded from listStores
		const notDeleted = await db
			.select()
			.from(storeTable)
			.where(isNull(storeTable.deletedAt));
		expect(notDeleted).toHaveLength(0);
	});

	it("throws ServiceError 404 for unknown store", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		await expect(
			deleteStore({
				storeId: crypto.randomUUID(),
				sellerProfileId: seller.profile.id,
			}),
		).rejects.toBeInstanceOf(ServiceError);
	});
});
