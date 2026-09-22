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

import { ServiceError } from "@/lib/errors";
import { deleteProductCategory } from "@/modules/admin/services/product-categories";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCategory,
	createTestMacroCategory,
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

// ── deleteProductCategory ───────────────────────────────────────────────────

describe("deleteProductCategory", () => {
	it("rejects with 409 when a product uses the category", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const macro = await createTestMacroCategory(db, "Elettronica");
		const cat = await createTestCategory(db, "Smartphone", macro.id);
		await createTestProduct(db, seller.profile.id, {
			name: "Telefono",
			categoryIds: [cat.id],
		});

		let caught: unknown;
		try {
			await deleteProductCategory(cat.id);
		} catch (e) {
			caught = e;
		}

		expect(caught).toBeInstanceOf(ServiceError);
		expect((caught as ServiceError).status).toBe(409);
		expect((caught as ServiceError).message).toBe(
			"Categoria non eliminabile: 1 prodotto la usa. Riassegnali a un'altra categoria e riprova.",
		);
	});

	it("deletes a category with no products", async () => {
		const db = getTestDb();
		const macro = await createTestMacroCategory(db, "Elettronica");
		const cat = await createTestCategory(db, "Tablet", macro.id);

		const deleted = await deleteProductCategory(cat.id);

		expect(deleted.id).toBe(cat.id);
	});
});
