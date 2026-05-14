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

import {
	archiveDiscount,
	createDiscount,
	pauseDiscount,
	updateDiscount,
} from "@/modules/seller/services/discounts";
import { truncateAll } from "../helpers/cleanup";
import { createTestDiscount, createTestSeller } from "../helpers/fixtures";

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
