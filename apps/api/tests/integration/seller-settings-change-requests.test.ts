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
import { sellerProfile } from "@/db/schemas/seller";
import { sellerProfileChange } from "@/db/schemas/seller-profile-change";
import { requestVatChange } from "@/modules/seller/services/settings";
import { truncateAll } from "../helpers/cleanup";
import { createTestOrganization, createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

async function sellerWithOrg(vatNumber: string) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	await createTestOrganization(db, seller.profile.id, { vatNumber });
	return seller;
}

describe("requestVatChange", () => {
	it("creates a pending request and blocks new orders", async () => {
		const seller = await sellerWithOrg("IT00000000001");

		const change = await requestVatChange({
			sellerProfileId: seller.profile.id,
			vatNumber: "IT00000000002",
		});

		expect(change.status).toBe("pending");
		const [profile] = await getTestDb()
			.select()
			.from(sellerProfile)
			.where(eq(sellerProfile.id, seller.profile.id));
		expect(profile.vatChangeBlocked).toBe(true);
	});

	it("rejects a VAT number already registered by another seller with 409", async () => {
		await sellerWithOrg("IT00000000009");
		const seller = await sellerWithOrg("IT00000000001");

		await expect(
			requestVatChange({
				sellerProfileId: seller.profile.id,
				vatNumber: "IT00000000009",
			}),
		).rejects.toMatchObject({ status: 409 });

		const changes = await getTestDb().select().from(sellerProfileChange);
		expect(changes).toEqual([]);
	});

	it("rejects a second pending VAT request with 409", async () => {
		const seller = await sellerWithOrg("IT00000000001");
		await requestVatChange({
			sellerProfileId: seller.profile.id,
			vatNumber: "IT00000000002",
		});

		await expect(
			requestVatChange({
				sellerProfileId: seller.profile.id,
				vatNumber: "IT00000000003",
			}),
		).rejects.toMatchObject({ status: 409 });
	});
});
