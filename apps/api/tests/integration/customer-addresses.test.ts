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
import { customerAddress } from "@/db/schemas/address";
import { ServiceError } from "@/lib/errors";
import {
	createAddress,
	deleteAddress,
	listAddresses,
	updateAddress,
} from "@/modules/customer/services/addresses";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestMunicipality,
} from "../helpers/fixtures";

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

// ── listAddresses ─────────────────────────────────────────────────────────────

describe("listAddresses", () => {
	it("returns empty list when customer has no addresses", async () => {
		const db = getTestDb();
		const customer = await createTestCustomer(db);

		const result = await listAddresses({
			customerProfileId: customer.profile.id,
		});

		expect(result.data).toHaveLength(0);
		expect(result.pagination.total).toBe(0);
	});

	it("returns only the customer's own addresses", async () => {
		const db = getTestDb();
		const a = await createTestCustomer(db, { email: "a@test.com" });
		const b = await createTestCustomer(db, { email: "b@test.com" });
		const mun = await createTestMunicipality(db);

		await createAddress({
			customerProfileId: a.profile.id,
			addressLine1: "Via A",
			municipalityId: mun.id,
			zipCode: "20100",
		});
		await createAddress({
			customerProfileId: a.profile.id,
			addressLine1: "Via A2",
			municipalityId: mun.id,
			zipCode: "20101",
		});
		await createAddress({
			customerProfileId: b.profile.id,
			addressLine1: "Via B",
			municipalityId: mun.id,
			zipCode: "00100",
		});

		const result = await listAddresses({
			customerProfileId: a.profile.id,
		});

		expect(result.data).toHaveLength(2);
		expect(
			result.data.every((addr) => addr.customerProfileId === a.profile.id),
		).toBe(true);
	});
});

// ── createAddress ─────────────────────────────────────────────────────────────

describe("createAddress", () => {
	it("creates an address with default isDefault=false", async () => {
		const db = getTestDb();
		const customer = await createTestCustomer(db);
		const mun = await createTestMunicipality(db);

		const created = await createAddress({
			customerProfileId: customer.profile.id,
			label: "Casa",
			addressLine1: "Via Dante 1",
			municipalityId: mun.id,
			zipCode: "20121",
		});

		expect(created.label).toBe("Casa");
		expect(created.isDefault).toBe(false);
	});

	it("unsets previous default when creating a new isDefault address", async () => {
		const db = getTestDb();
		const customer = await createTestCustomer(db);
		const mun = await createTestMunicipality(db);

		await createAddress({
			customerProfileId: customer.profile.id,
			addressLine1: "Via 1",
			municipalityId: mun.id,
			zipCode: "00100",
			isDefault: true,
		});

		const second = await createAddress({
			customerProfileId: customer.profile.id,
			addressLine1: "Via 2",
			municipalityId: mun.id,
			zipCode: "00101",
			isDefault: true,
		});

		const defaults = await db
			.select()
			.from(customerAddress)
			.where(eq(customerAddress.isDefault, true));
		expect(defaults).toHaveLength(1);
		expect(defaults[0].id).toBe(second.id);
	});
});

// ── updateAddress ─────────────────────────────────────────────────────────────

describe("updateAddress", () => {
	it("updates label and address fields", async () => {
		const db = getTestDb();
		const customer = await createTestCustomer(db);
		const mun = await createTestMunicipality(db);
		const addr = await createAddress({
			customerProfileId: customer.profile.id,
			label: "Old",
			addressLine1: "Via Vecchia",
			municipalityId: mun.id,
			zipCode: "00100",
		});

		const updated = await updateAddress({
			addressId: addr.id,
			customerProfileId: customer.profile.id,
			label: "New",
			addressLine1: "Via Nuova",
		});

		expect(updated.label).toBe("New");
		expect(updated.addressLine1).toBe("Via Nuova");
	});

	it("unsets previous default when promoting another to default", async () => {
		const db = getTestDb();
		const customer = await createTestCustomer(db);
		const mun = await createTestMunicipality(db);
		const first = await createAddress({
			customerProfileId: customer.profile.id,
			addressLine1: "Via 1",
			municipalityId: mun.id,
			zipCode: "00100",
			isDefault: true,
		});
		const second = await createAddress({
			customerProfileId: customer.profile.id,
			addressLine1: "Via 2",
			municipalityId: mun.id,
			zipCode: "00101",
		});

		await updateAddress({
			addressId: second.id,
			customerProfileId: customer.profile.id,
			isDefault: true,
		});

		const [firstRow] = await db
			.select()
			.from(customerAddress)
			.where(eq(customerAddress.id, first.id));
		const [secondRow] = await db
			.select()
			.from(customerAddress)
			.where(eq(customerAddress.id, second.id));

		expect(firstRow.isDefault).toBe(false);
		expect(secondRow.isDefault).toBe(true);
	});

	it("throws ServiceError 404 when address belongs to another customer", async () => {
		const db = getTestDb();
		const owner = await createTestCustomer(db, { email: "owner@test.com" });
		const other = await createTestCustomer(db, { email: "other@test.com" });
		const mun = await createTestMunicipality(db);
		const addr = await createAddress({
			customerProfileId: owner.profile.id,
			addressLine1: "Via",
			municipalityId: mun.id,
			zipCode: "00100",
		});

		await expect(
			updateAddress({
				addressId: addr.id,
				customerProfileId: other.profile.id,
				label: "Hacked",
			}),
		).rejects.toMatchObject({ status: 404 });
	});
});

// ── deleteAddress ─────────────────────────────────────────────────────────────

describe("deleteAddress", () => {
	it("deletes an owned address", async () => {
		const db = getTestDb();
		const customer = await createTestCustomer(db);
		const mun = await createTestMunicipality(db);
		const addr = await createAddress({
			customerProfileId: customer.profile.id,
			addressLine1: "Via",
			municipalityId: mun.id,
			zipCode: "00100",
		});

		const deleted = await deleteAddress({
			addressId: addr.id,
			customerProfileId: customer.profile.id,
		});

		expect(deleted.id).toBe(addr.id);

		const result = await listAddresses({
			customerProfileId: customer.profile.id,
		});
		expect(result.data).toHaveLength(0);
	});

	it("throws ServiceError 404 when address does not belong to customer", async () => {
		const db = getTestDb();
		const owner = await createTestCustomer(db, { email: "owner@test.com" });
		const other = await createTestCustomer(db, { email: "other@test.com" });
		const mun = await createTestMunicipality(db);
		const addr = await createAddress({
			customerProfileId: owner.profile.id,
			addressLine1: "Via",
			municipalityId: mun.id,
			zipCode: "00100",
		});

		await expect(
			deleteAddress({
				addressId: addr.id,
				customerProfileId: other.profile.id,
			}),
		).rejects.toBeInstanceOf(ServiceError);
	});
});
