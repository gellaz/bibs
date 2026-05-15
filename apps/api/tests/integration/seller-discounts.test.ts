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

import { getBestActiveDiscount } from "@/modules/seller/services/discount-pricing";
import {
	addProductsToDiscount,
	archiveDiscount,
	createDiscount,
	getDiscountById,
	getDiscountProducts,
	listDiscounts,
	pauseDiscount,
	removeProductsFromDiscount,
	updateDiscount,
} from "@/modules/seller/services/discounts";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestDiscount,
	createTestProduct,
	createTestSeller,
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

describe("createDiscount", () => {
	it("creates a discount with valid params and default status active", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const startsAt = new Date(Date.now() + 86_400_000);
		const endsAt = new Date(Date.now() + 2 * 86_400_000);

		const d = await createDiscount({
			sellerProfileId: seller.profile.id,
			title: "Saldi estivi",
			percent: 25,
			startsAt,
			endsAt,
		});

		expect(d.title).toBe("Saldi estivi");
		expect(d.percent).toBe(25);
		expect(d.status).toBe("active");
		expect(d.endsAt?.toISOString()).toBe(endsAt.toISOString());
	});

	it("creates a discount with endsAt null", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		const d = await createDiscount({
			sellerProfileId: seller.profile.id,
			title: "Senza scadenza",
			percent: 10,
			startsAt: new Date(),
			endsAt: null,
		});

		expect(d.endsAt).toBeNull();
	});

	it("rejects percent out of range", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);

		await expect(
			createDiscount({
				sellerProfileId: seller.profile.id,
				title: "Bad",
				percent: 0,
				startsAt: new Date(),
				endsAt: null,
			}),
		).rejects.toThrow();

		await expect(
			createDiscount({
				sellerProfileId: seller.profile.id,
				title: "Bad",
				percent: 100,
				startsAt: new Date(),
				endsAt: null,
			}),
		).rejects.toThrow();
	});

	it("rejects endsAt <= startsAt", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const startsAt = new Date();

		await expect(
			createDiscount({
				sellerProfileId: seller.profile.id,
				title: "Bad",
				percent: 10,
				startsAt,
				endsAt: startsAt,
			}),
		).rejects.toThrow();
	});

	it("rejects empty title", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await expect(
			createDiscount({
				sellerProfileId: seller.profile.id,
				title: "   ",
				percent: 10,
				startsAt: new Date(),
				endsAt: null,
			}),
		).rejects.toThrow();
	});
});

describe("updateDiscount", () => {
	it("updates title and endsAt at any time", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		// running promo (startsAt in the past)
		const d = await createTestDiscount(db, seller.profile.id, {
			startsAt: new Date(Date.now() - 3600_000),
			endsAt: new Date(Date.now() + 86_400_000),
		});
		const newEnd = new Date(Date.now() + 2 * 86_400_000);

		const updated = await updateDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			patch: { title: "Saldi prolungati", endsAt: newEnd },
		});

		expect(updated.title).toBe("Saldi prolungati");
		expect(updated.endsAt?.toISOString()).toBe(newEnd.toISOString());
	});

	it("allows changing percent before start", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, {
			startsAt: new Date(Date.now() + 86_400_000), // future
			endsAt: new Date(Date.now() + 2 * 86_400_000),
			percent: 10,
		});

		const updated = await updateDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			patch: { percent: 30 },
		});
		expect(updated.percent).toBe(30);
	});

	it("rejects percent change once started (409)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, {
			startsAt: new Date(Date.now() - 3600_000), // started
			endsAt: new Date(Date.now() + 86_400_000),
			percent: 10,
		});

		await expect(
			updateDiscount({
				discountId: d.id,
				sellerProfileId: seller.profile.id,
				patch: { percent: 30 },
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("rejects startsAt change once started (409)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, {
			startsAt: new Date(Date.now() - 3600_000),
		});

		await expect(
			updateDiscount({
				discountId: d.id,
				sellerProfileId: seller.profile.id,
				patch: { startsAt: new Date(Date.now() + 86_400_000) },
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("rejects endsAt in the past", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id);

		await expect(
			updateDiscount({
				discountId: d.id,
				sellerProfileId: seller.profile.id,
				patch: { endsAt: new Date(Date.now() - 86_400_000) },
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("returns 404 if discount does not exist or belongs to another seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const d = await createTestDiscount(db, sellerA.profile.id);

		await expect(
			updateDiscount({
				discountId: d.id,
				sellerProfileId: sellerB.profile.id,
				patch: { title: "Hack" },
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("pauseDiscount", () => {
	it("toggles active → paused", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, {
			status: "active",
		});
		const out = await pauseDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
		});
		expect(out.status).toBe("paused");
	});

	it("toggles paused → active", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, {
			status: "paused",
		});
		const out = await pauseDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
		});
		expect(out.status).toBe("active");
	});

	it("returns 409 on archived", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, {
			status: "archived",
		});
		await expect(
			pauseDiscount({ discountId: d.id, sellerProfileId: seller.profile.id }),
		).rejects.toMatchObject({ status: 409 });
	});

	it("returns 404 for wrong seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const d = await createTestDiscount(db, sellerA.profile.id);
		await expect(
			pauseDiscount({ discountId: d.id, sellerProfileId: sellerB.profile.id }),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("archiveDiscount", () => {
	it("moves to archived", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id);
		const out = await archiveDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
		});
		expect(out.status).toBe("archived");
	});

	it("rejects re-archive (409)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id, {
			status: "archived",
		});
		await expect(
			archiveDiscount({ discountId: d.id, sellerProfileId: seller.profile.id }),
		).rejects.toMatchObject({ status: 409 });
	});
});

describe("addProductsToDiscount", () => {
	it("inserts all valid products, idempotent on re-add", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		const d = await createTestDiscount(db, seller.profile.id);

		const r1 = await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id, p2.id],
		});
		expect(r1.added).toBe(2);
		expect(r1.alreadyPresent).toBe(0);
		expect(r1.rejected).toEqual([]);

		const r2 = await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id, p2.id],
		});
		expect(r2.added).toBe(0);
		expect(r2.alreadyPresent).toBe(2);
	});

	it("rejects products of another seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const pA = await createTestProduct(db, sellerA.profile.id);
		const pB = await createTestProduct(db, sellerB.profile.id);
		const d = await createTestDiscount(db, sellerA.profile.id);

		const r = await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: sellerA.profile.id,
			productIds: [pA.id, pB.id],
		});
		expect(r.added).toBe(1);
		expect(r.rejected).toEqual([pB.id]);
	});

	it("404 if discount does not belong to seller", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const d = await createTestDiscount(db, sellerA.profile.id);
		await expect(
			addProductsToDiscount({
				discountId: d.id,
				sellerProfileId: sellerB.profile.id,
				productIds: [],
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("removeProductsFromDiscount", () => {
	it("removes only specified products", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });
		const d = await createTestDiscount(db, seller.profile.id);
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id, p2.id],
		});

		const r = await removeProductsFromDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id],
		});
		expect(r.removed).toBe(1);
	});
});

describe("listDiscounts", () => {
	it("filters by operational state 'running'", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestDiscount(db, seller.profile.id, {
			title: "Running",
			startsAt: new Date(Date.now() - 3600_000),
			endsAt: new Date(Date.now() + 86_400_000),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Scheduled",
			startsAt: new Date(Date.now() + 86_400_000),
			endsAt: new Date(Date.now() + 2 * 86_400_000),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Expired",
			startsAt: new Date(Date.now() - 2 * 86_400_000),
			endsAt: new Date(Date.now() - 86_400_000),
		});

		const result = await listDiscounts({
			sellerProfileId: seller.profile.id,
			state: "running",
		});
		expect(result.data).toHaveLength(1);
		expect(result.data[0].title).toBe("Running");
	});

	it("filters 'archived' separately, hidden from 'all'", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		await createTestDiscount(db, seller.profile.id, {
			title: "Active",
			status: "active",
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Arch",
			status: "archived",
		});

		const all = await listDiscounts({
			sellerProfileId: seller.profile.id,
			state: "all",
		});
		expect(all.data.find((d) => d.title === "Arch")).toBeUndefined();

		const arch = await listDiscounts({
			sellerProfileId: seller.profile.id,
			state: "archived",
		});
		expect(arch.data).toHaveLength(1);
	});

	it("includes productCount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const d = await createTestDiscount(db, seller.profile.id);
		const p1 = await createTestProduct(db, seller.profile.id);
		const p2 = await createTestProduct(db, seller.profile.id);
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id, p2.id],
		});

		const list = await listDiscounts({ sellerProfileId: seller.profile.id });
		expect(list.data[0].productCount).toBe(2);
	});

	it("does not leak other sellers' discounts", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		await createTestDiscount(db, sellerA.profile.id, { title: "A" });
		await createTestDiscount(db, sellerB.profile.id, { title: "B" });

		const out = await listDiscounts({ sellerProfileId: sellerA.profile.id });
		expect(out.data.map((d) => d.title)).toEqual(["A"]);
	});
});

describe("getDiscountById", () => {
	it("returns the discount + productCount, 404 if not owned", async () => {
		const db = getTestDb();
		const sellerA = await createTestSeller(db, { email: "a@test.com" });
		const sellerB = await createTestSeller(db, { email: "b@test.com" });
		const d = await createTestDiscount(db, sellerA.profile.id);

		const found = await getDiscountById({
			discountId: d.id,
			sellerProfileId: sellerA.profile.id,
		});
		expect(found.id).toBe(d.id);
		expect(found.productCount).toBe(0);

		await expect(
			getDiscountById({
				discountId: d.id,
				sellerProfileId: sellerB.profile.id,
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

describe("getDiscountProducts", () => {
	it("returns paginated products with original and discounted prices", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, {
			name: "P1",
			price: "100.00",
		});
		const d = await createTestDiscount(db, seller.profile.id, { percent: 25 });
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p1.id],
		});

		const res = await getDiscountProducts({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
		});
		expect(res.data).toHaveLength(1);
		expect(res.data[0].id).toBe(p1.id);
		expect(res.data[0].originalPrice).toBe("100.00");
		expect(res.data[0].discountedPrice).toBe("75.00");
	});
});

describe("getBestActiveDiscount", () => {
	it("returns null when no active discount", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id);
		expect(await getBestActiveDiscount(p.id)).toBeNull();
	});

	it("returns the discount with highest percent among active running", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, {
			price: "100.00",
		});
		const d10 = await createTestDiscount(db, seller.profile.id, {
			percent: 10,
			title: "ten",
		});
		const d30 = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			title: "thirty",
		});
		await addProductsToDiscount({
			discountId: d10.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});
		await addProductsToDiscount({
			discountId: d30.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});

		const out = await getBestActiveDiscount(p.id);
		expect(out?.percent).toBe(30);
		expect(out?.discountedPrice).toBe("70.00");
	});

	it("ignores paused discounts", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id);
		const d = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			status: "paused",
		});
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});
		expect(await getBestActiveDiscount(p.id)).toBeNull();
	});

	it("ignores expired and scheduled discounts", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id);
		const dExpired = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			startsAt: new Date(Date.now() - 2 * 86_400_000),
			endsAt: new Date(Date.now() - 86_400_000),
		});
		const dScheduled = await createTestDiscount(db, seller.profile.id, {
			percent: 30,
			startsAt: new Date(Date.now() + 86_400_000),
			endsAt: new Date(Date.now() + 2 * 86_400_000),
		});
		await addProductsToDiscount({
			discountId: dExpired.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});
		await addProductsToDiscount({
			discountId: dScheduled.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});
		expect(await getBestActiveDiscount(p.id)).toBeNull();
	});

	it("respects endsAt NULL (no expiration)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p = await createTestProduct(db, seller.profile.id, {
			price: "50.00",
		});
		const d = await createTestDiscount(db, seller.profile.id, {
			percent: 20,
			endsAt: null,
		});
		await addProductsToDiscount({
			discountId: d.id,
			sellerProfileId: seller.profile.id,
			productIds: [p.id],
		});
		const out = await getBestActiveDiscount(p.id);
		expect(out?.percent).toBe(20);
		expect(out?.discountedPrice).toBe("40.00");
	});
});
