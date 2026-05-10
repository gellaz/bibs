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
import { productAuditLog } from "@/db/schemas/product-audit-log";
import {
	recordProductAudit,
	recordProductAuditBatch,
} from "@/modules/seller/services/product-audit";
import { truncateAll } from "../helpers/cleanup";
import { createTestProduct, createTestSeller } from "../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
});

describe("recordProductAudit", () => {
	it("inserts an audit row with action and actor", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const product = await createTestProduct(db, seller.profile.id);

		await recordProductAudit({
			productId: product.id,
			actorUserId: seller.user.id,
			action: "disabled",
			metadata: { reason: "out of stock" },
		});

		const rows = await db.query.productAuditLog.findMany({
			where: eq(productAuditLog.productId, product.id),
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].action).toBe("disabled");
		expect(rows[0].actorUserId).toBe(seller.user.id);
		expect(rows[0].metadata).toEqual({ reason: "out of stock" });
	});

	it("supports null actorUserId for system actions", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const product = await createTestProduct(db, seller.profile.id);

		await recordProductAudit({
			productId: product.id,
			actorUserId: null,
			action: "created",
		});

		const rows = await db.query.productAuditLog.findMany({
			where: eq(productAuditLog.productId, product.id),
		});
		expect(rows[0].actorUserId).toBeNull();
	});
});

describe("recordProductAuditBatch", () => {
	it("inserts multiple rows in a single insert", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const p1 = await createTestProduct(db, seller.profile.id, { name: "P1" });
		const p2 = await createTestProduct(db, seller.profile.id, { name: "P2" });

		await recordProductAuditBatch([
			{ productId: p1.id, actorUserId: seller.user.id, action: "trashed" },
			{ productId: p2.id, actorUserId: seller.user.id, action: "trashed" },
		]);

		const rows = await db.query.productAuditLog.findMany();
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.action === "trashed")).toBe(true);
	});

	it("is a no-op on empty input", async () => {
		await expect(recordProductAuditBatch([])).resolves.toBeUndefined();
	});
});
