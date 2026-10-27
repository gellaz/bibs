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
} from "../../../helpers/test-db";

mock.module("@/db", () => ({
	db: new Proxy({} as any, {
		get(_, prop) {
			return (getTestDb() as any)[prop];
		},
	}),
}));

const sendEmail = mock(
	async (_params: { to: string; subject: string; html: string }) => {},
);
mock.module("@/infra/email", () => ({ sendEmail }));

mock.module("@/infra/s3", () => ({
	s3: { write: mock(async () => {}), delete: mock(async () => {}) },
	publicUrl: (key: string) => `https://cdn.test/${key}`,
}));

import { eq } from "drizzle-orm";
import { user } from "@/db/schemas/auth";
import { sellerProfile } from "@/db/schemas/seller";
import { sellerProfileChange } from "@/db/schemas/seller-profile-change";
import { approveChange, rejectChange } from "@/modules/admin/services/sellers";
import { updateCompany } from "@/modules/seller/services/onboarding";
import { requestVatChange } from "@/modules/seller/services/settings";
import { truncateAll } from "../../../helpers/cleanup";
import {
	createTestMunicipality,
	createTestOrganization,
	createTestSeller,
} from "../../../helpers/fixtures";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
	sendEmail.mockReset();
	sendEmail.mockImplementation(async () => {});
});

async function seedAdmin(email: string, banned = false) {
	const id = crypto.randomUUID();
	await getTestDb().insert(user).values({
		id,
		name: "Admin",
		email,
		emailVerified: true,
		role: "admin",
		banned,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	return id;
}

async function sellerWithOrg() {
	const db = getTestDb();
	const seller = await createTestSeller(db, { email: "titolare@test.com" });
	await createTestOrganization(db, seller.profile.id, {
		vatNumber: "IT00000000001",
	});
	return seller;
}

const sent = () => sendEmail.mock.calls.map(([p]) => p);

describe("email agli admin", () => {
	it("cambio P.IVA: una sola email, all'admin non bannato, col link alla richiesta", async () => {
		await seedAdmin("admin@test.com");
		await seedAdmin("bannato@test.com", true);
		const seller = await sellerWithOrg();

		const change = await requestVatChange({
			sellerProfileId: seller.profile.id,
			vatNumber: "IT00000000002",
		});

		expect(sent()).toHaveLength(1);
		expect(sent()[0].to).toBe("admin@test.com");
		expect(sent()[0].html).toContain(`/requests/${change.id}`);
	});

	it("fine onboarding: email agli admin col link alla candidatura", async () => {
		await seedAdmin("admin@test.com");
		const db = getTestDb();
		const municipality = await createTestMunicipality(db);
		const seller = await createTestSeller(db, { email: "nuovo@test.com" });
		await db
			.update(sellerProfile)
			.set({ onboardingStatus: "pending_company" })
			.where(eq(sellerProfile.id, seller.profile.id));

		await updateCompany({
			userId: seller.user.id,
			businessName: "Forno Rossi",
			vatNumber: "IT00000000009",
			legalForm: "srl",
			addressLine1: "Via Roma 1",
			municipalityId: municipality.id,
			zipCode: "40100",
		});

		const toAdmin = sent().filter((p) => p.to === "admin@test.com");
		expect(toAdmin).toHaveLength(1);
		expect(toAdmin[0].html).toContain(`/sellers/${seller.profile.id}`);
	});

	it("nessun admin: nessun errore", async () => {
		const seller = await sellerWithOrg();
		await requestVatChange({
			sellerProfileId: seller.profile.id,
			vatNumber: "IT00000000002",
		});
		expect(sent()).toHaveLength(0);
	});

	it("sendEmail che lancia: la richiesta resta creata", async () => {
		await seedAdmin("admin@test.com");
		sendEmail.mockImplementation(async () => {
			throw new Error("smtp down");
		});
		const seller = await sellerWithOrg();

		const change = await requestVatChange({
			sellerProfileId: seller.profile.id,
			vatNumber: "IT00000000002",
		});

		const [row] = await getTestDb()
			.select()
			.from(sellerProfileChange)
			.where(eq(sellerProfileChange.id, change.id));
		expect(row.status).toBe("pending");
	});
});

describe("email al venditore sull'esito", () => {
	async function pendingVat() {
		const adminId = await seedAdmin("admin@test.com");
		const seller = await sellerWithOrg();
		const [change] = await getTestDb()
			.insert(sellerProfileChange)
			.values({
				sellerProfileId: seller.profile.id,
				changeType: "vat",
				changeData: { vatNumber: "12345678903" },
			})
			.returning();
		return { adminId, change };
	}

	it("rejectChange con motivo: email al titolare con il motivo", async () => {
		const { adminId, change } = await pendingVat();

		await rejectChange({
			changeId: change.id,
			adminUserId: adminId,
			reason: "Partita IVA non valida",
		});

		expect(sent()).toHaveLength(1);
		expect(sent()[0].to).toBe("titolare@test.com");
		expect(sent()[0].html).toContain("Motivo");
		expect(sent()[0].html).toContain("Partita IVA non valida");
	});

	it("approveChange: email di approvazione al titolare", async () => {
		const { adminId, change } = await pendingVat();

		await approveChange(change.id, adminId);

		expect(sent()).toHaveLength(1);
		expect(sent()[0].to).toBe("titolare@test.com");
		expect(sent()[0].html).toContain("abbiamo approvato la modifica");
	});

	it("nessuna email se la decisione fallisce", async () => {
		const { adminId, change } = await pendingVat();
		await approveChange(change.id, adminId);
		sendEmail.mockClear();

		await expect(approveChange(change.id, adminId)).rejects.toMatchObject({
			status: 400,
		});
		expect(sent()).toHaveLength(0);
	});
});
