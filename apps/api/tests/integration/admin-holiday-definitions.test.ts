// apps/api/tests/integration/admin-holiday-definitions.test.ts
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { eq } from "drizzle-orm";
import { user } from "@/db/schemas/auth";
import { storeHolidayOptout } from "@/db/schemas/store-holiday-optout";
import {
	getTestDb,
	setupTestContainer,
	teardownTestContainer,
} from "../helpers/test-db";

const { mock } = await import("bun:test");
mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

const {
	createHolidayDefinition,
	deleteHolidayDefinition,
	listHolidayDefinitions,
	previewHolidayYear,
	updateHolidayDefinition,
} = await import("@/modules/admin/services/holiday-definitions");
const { createTestSeller, createTestStore } = await import(
	"../helpers/fixtures"
);
const { truncateAll } = await import("../helpers/cleanup");

async function seedAdmin(email: string): Promise<string> {
	const id = crypto.randomUUID();
	await getTestDb().insert(user).values({
		id,
		name: "Admin",
		email,
		emailVerified: true,
		role: "admin",
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	return id;
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

describe("admin holiday-definitions service", () => {
	it("creates a fixed holiday and lists it", async () => {
		const adminId = await seedAdmin("a1@test.com");
		const created = await createHolidayDefinition(
			{ type: "fixed", name: "Natale", month: 12, day: 25 },
			adminId,
		);
		expect(created.type).toBe("fixed");
		expect(created.month).toBe(12);
		expect(created.isActive).toBe(true);
		const all = await listHolidayDefinitions();
		expect(all).toHaveLength(1);
	});

	it("toggles isActive via update", async () => {
		const adminId = await seedAdmin("a2@test.com");
		const created = await createHolidayDefinition(
			{ type: "easter_relative", name: "Pasquetta", easterOffsetDays: 1 },
			adminId,
		);
		const updated = await updateHolidayDefinition({
			id: created.id,
			isActive: false,
		});
		expect(updated.isActive).toBe(false);
	});

	it("update on a missing id throws 404", async () => {
		await expect(
			updateHolidayDefinition({ id: "nope", name: "x" }),
		).rejects.toMatchObject({ status: 404 });
	});

	it("delete cascades to store opt-outs", async () => {
		const db = getTestDb();
		const adminId = await seedAdmin("a3@test.com");
		const { profile } = await createTestSeller(db);
		const store = await createTestStore(db, profile.id);
		const def = await createHolidayDefinition(
			{ type: "fixed", name: "Ferragosto", month: 8, day: 15 },
			adminId,
		);
		await db
			.insert(storeHolidayOptout)
			.values({ storeId: store.id, holidayDefinitionId: def.id });

		await deleteHolidayDefinition(def.id);

		const remaining = await db
			.select()
			.from(storeHolidayOptout)
			.where(eq(storeHolidayOptout.holidayDefinitionId, def.id));
		expect(remaining).toHaveLength(0);
	});

	it("preview resolves active defs to concrete dates for a year", async () => {
		const adminId = await seedAdmin("a4@test.com");
		await createHolidayDefinition(
			{ type: "easter_relative", name: "Pasquetta", easterOffsetDays: 1 },
			adminId,
		);
		await createHolidayDefinition(
			{ type: "fixed", name: "Natale", month: 12, day: 25 },
			adminId,
		);
		const preview = await previewHolidayYear(2026);
		const dates = preview.map((p) => p.date);
		expect(dates).toContain("2026-04-06"); // Pasquetta 2026
		expect(dates).toContain("2026-12-25");
	});
});
