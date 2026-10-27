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

import { eq } from "drizzle-orm";
import { sellerProfile } from "@/db/schemas/seller";
import {
	type ChangeStatus,
	sellerProfileChange,
} from "@/db/schemas/seller-profile-change";
import { requestsRoutes } from "@/modules/admin/routes/requests";
import {
	countRequests,
	getChangeDetail,
	listRequests,
} from "@/modules/admin/services/requests";
import { truncateAll } from "../../../helpers/cleanup";
import {
	createTestMunicipality,
	createTestOrganization,
	createTestSeller,
} from "../../../helpers/fixtures";
import { testRequest, withVars } from "../../../helpers/hono-app";

// Utente admin già risolto a monte (D13 del piano Hono): `requireAdmin` non
// rilegge la sessione, come le route nude dell'harness di prima.
const app = withVars(requestsRoutes, {
	user: { id: "admin-1", role: "admin" },
});

const get = (path: string) => testRequest(app, path);

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

async function seedSeller(
	status: "pending_review" | "active",
	params: { name?: string; email?: string; vatNumber?: string } = {},
) {
	const db = getTestDb();
	const seller = await createTestSeller(db, params);
	await db
		.update(sellerProfile)
		.set({ onboardingStatus: status })
		.where(eq(sellerProfile.id, seller.profile.id));
	await createTestOrganization(db, seller.profile.id, {
		businessName: `Biz ${seller.profile.id.slice(0, 4)}`,
		vatNumber: params.vatNumber,
	});
	return seller;
}

async function addChange(params: {
	sellerProfileId: string;
	changeType: "vat" | "document";
	changeData: unknown;
	status?: ChangeStatus;
	createdAt: Date;
}) {
	const [row] = await getTestDb()
		.insert(sellerProfileChange)
		.values(params)
		.returning();
	return row;
}

async function seedAll() {
	const db = getTestDb();
	const cand = await seedSeller("pending_review", { name: "Cand" });
	await db
		.update(sellerProfile)
		.set({ updatedAt: day(2) })
		.where(eq(sellerProfile.id, cand.profile.id));
	const active = await seedSeller("active", {
		name: "Attivo",
		vatNumber: "11111111111",
	});
	const vat = await addChange({
		sellerProfileId: active.profile.id,
		changeType: "vat",
		changeData: { vatNumber: "22222222222" },
		createdAt: day(3),
	});
	const other = await seedSeller("active");
	const doc = await addChange({
		sellerProfileId: other.profile.id,
		changeType: "document",
		changeData: {
			documentType: "passport",
			documentNumber: "YA1234567",
			documentExpiry: "2032-01-01",
			documentIssuedMunicipalityId: (await createTestMunicipality(db)).id,
		},
		createdAt: day(1),
	});
	return { cand, active, vat, other, doc };
}

describe("admin requests", () => {
	it("lists candidates and pending changes by submittedAt ascending", async () => {
		const { cand, vat, doc } = await seedAll();
		const res = await listRequests({});
		expect(res.data.map((r) => [r.kind, r.id])).toEqual([
			["document", doc.id],
			["candidature", cand.profile.id],
			["vat", vat.id],
		]);
		expect(res.pagination.total).toBe(3);
		const vatRow = res.data[2];
		expect(vatRow.currentValue).toBe("11111111111");
		expect(vatRow.requestedValue).toBe("22222222222");
		expect(vatRow.seller.name).toBe("Attivo");
		expect(res.data[0].requestedValue).toBe("Passaporto YA1234567");
	});

	it("filters by type and paginates after filtering", async () => {
		const { vat } = await seedAll();
		const res = await listRequests({ type: "vat" });
		expect(res.data.map((r) => r.id)).toEqual([vat.id]);
		const page2 = await listRequests({ page: 2, limit: 2 });
		expect(page2.data).toHaveLength(1);
		expect(page2.pagination.total).toBe(3);
	});

	it("skips rejected and cancelled changes", async () => {
		const { active, other } = await seedAll();
		for (const [s, status] of [
			[active, "rejected"],
			[other, "cancelled"],
		] as const)
			await getTestDb()
				.update(sellerProfileChange)
				.set({ status })
				.where(eq(sellerProfileChange.sellerProfileId, s.profile.id));
		const res = await listRequests({});
		expect(res.data.map((r) => r.kind)).toEqual(["candidature"]);
	});

	it("counts match the list", async () => {
		await seedAll();
		expect(await countRequests()).toEqual({
			total: 3,
			candidature: 1,
			vat: 1,
			document: 1,
		});
	});

	it("vat detail has current and requested", async () => {
		const { vat, active } = await seedAll();
		const d = await getChangeDetail(vat.id);
		expect(d.vat).toEqual({ current: "11111111111", requested: "22222222222" });
		expect(d.document).toBeNull();
		expect(d.status).toBe("pending");
		expect(d.seller.id).toBe(active.profile.id);
	});

	it("document detail resolves municipalities and keeps current image", async () => {
		const { doc, other } = await seedAll();
		const db = getTestDb();
		const current = await createTestMunicipality(db, {
			municipalityName: "Vecchio",
			provinceName: "Altra",
			provinceAcronym: "AA",
		});
		await db
			.update(sellerProfile)
			.set({
				documentType: "identity_card",
				documentNumber: "CA12345AB",
				documentExpiry: "2030-05-05",
				documentIssuedMunicipalityId: current.id,
				documentImageUrl: "https://cdn.test/old.jpg",
			})
			.where(eq(sellerProfile.id, other.profile.id));
		const d = await getChangeDetail(doc.id);
		expect(d.document?.current).toEqual({
			documentType: "identity_card",
			documentNumber: "CA12345AB",
			documentExpiry: "2030-05-05",
			issuedMunicipality: { name: "Vecchio", provinceAcronym: "AA" },
			imageUrl: "https://cdn.test/old.jpg",
		});
		expect(d.document?.requested.documentType).toBe("passport");
		expect(d.document?.requested.issuedMunicipality?.provinceAcronym).toBe(
			"TT",
		);
		expect(d.document?.requested.imageUrl).toBe("https://cdn.test/old.jpg");
	});

	it("document detail shows a null current type as null", async () => {
		const { doc } = await seedAll();
		const d = await getChangeDetail(doc.id);
		expect(d.document?.current.documentType).toBeNull();
		expect(d.document?.requested.documentType).toBe("passport");
	});

	it("detail of a cancelled change reports its status", async () => {
		const { vat } = await seedAll();
		await getTestDb()
			.update(sellerProfileChange)
			.set({ status: "cancelled" })
			.where(eq(sellerProfileChange.id, vat.id));
		expect((await getChangeDetail(vat.id)).status).toBe("cancelled");
	});

	it("document detail of a decided change hides the deleted photo", async () => {
		const { doc } = await seedAll();
		await getTestDb()
			.update(sellerProfileChange)
			.set({
				status: "rejected",
				changeData: {
					documentType: "passport",
					documentNumber: "YA1234567",
					documentExpiry: "2032-01-01",
					documentIssuedMunicipalityId: (
						await createTestMunicipality(getTestDb())
					).id,
					documentImageUrl: "https://cdn.test/new.jpg",
				},
			})
			.where(eq(sellerProfileChange.id, doc.id));
		const d = await getChangeDetail(doc.id);
		expect(d.document?.requested.imageUrl).toBeNull();
	});

	it("detail 404 when missing", async () => {
		await expect(getChangeDetail("nope")).rejects.toMatchObject({
			status: 404,
			message: "Richiesta di modifica non trovata",
		});
	});
});

describe("admin requests routes", () => {
	it("serves list, counts and detail with the schema shapes", async () => {
		const { vat } = await seedAll();
		const list = await (await get("/requests")).json();
		expect(list.success).toBe(true);
		expect(list.data).toHaveLength(3);
		expect(list.data[0]).toHaveProperty("submittedAt");
		expect(list.pagination.total).toBe(3);

		const counts = await (await get("/requests/counts")).json();
		expect(counts.data).toEqual({
			total: 3,
			candidature: 1,
			vat: 1,
			document: 1,
		});

		const detail = await (await get(`/requests/changes/${vat.id}`)).json();
		expect(detail.data.changeType).toBe("vat");
		expect((await get("/requests/changes/nope")).status).toBe(404);
	});

	it("rejects an unknown type with 422", async () => {
		expect((await get("/requests?type=foo")).status).toBe(422);
	});
});
