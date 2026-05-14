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

import { createDiscount } from "@/modules/seller/services/discounts";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller } from "../helpers/fixtures";

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
