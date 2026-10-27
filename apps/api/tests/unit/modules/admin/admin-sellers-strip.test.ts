import { beforeEach, describe, expect, it, mock } from "bun:test";
import { withVars } from "../../../helpers/hono-app";

// Strip delle route admin di U9 su Hono (trappola `normalize`, D4 del piano
// Hono): i campi ignoti in body e query non arrivano al servizio, le colonne in
// più restituite dal servizio non escono nella risposta, nemmeno annidate.
// Servizi finti, utente admin già risolto (`withVars`): niente DB. I body di
// U9 sono piatti: niente campi annidati da togliere in ingresso.

const calls: unknown[][] = [];
const at = new Date("2026-01-02T03:04:05.000Z");
const iso = at.toISOString();
const municipality = { id: "m1", name: "Bologna", provinceAcronym: "BO" };

const profile = {
	id: "s1",
	userId: "u1",
	onboardingStatus: "pending_review",
	firstName: "Anna",
	lastName: "Rossi",
	citizenship: "IT",
	birthCountry: "IT",
	birthDate: "1990-01-01",
	residenceCountry: "IT",
	residenceMunicipalityId: "m1",
	residenceMunicipality: { ...municipality, istatCode: "037006" },
	residenceAddress: "Via Roma 1",
	residenceZipCode: "40100",
	documentType: "identity_card",
	documentNumber: "CA1",
	documentExpiry: "2030-01-01",
	documentIssuedMunicipalityId: "m1",
	documentIssuedMunicipality: municipality,
	documentImageUrl: "https://cdn.test/doc.jpg",
	documentImageKey: "documents/s1/segreto",
	vatChangeBlocked: false,
	rejectionReason: null,
	createdAt: at,
	updatedAt: at,
};
const user = {
	id: "u1",
	name: "Anna Rossi",
	email: "anna@test.com",
	emailVerified: true,
	image: null,
	createdAt: at,
	updatedAt: at,
	role: "seller",
	banned: false,
	banReason: null,
	banExpires: null,
	stripeCustomerId: "cus_segreto",
};
const organization = {
	id: "o1",
	sellerProfileId: "s1",
	businessName: "Bottega Rossi",
	vatNumber: "12345678901",
	legalForm: "SRL",
	addressLine1: "Via Roma 1",
	country: "IT",
	municipalityId: "m1",
	municipality: { ...municipality, internal: true },
	zipCode: "40100",
	vatStatus: "pending",
	createdAt: at,
	updatedAt: at,
	stripeAccountId: "acct_segreto",
};

mock.module("@/modules/admin/services/sellers", () => ({
	countSellersByStatus: async () => ({
		pending_review: 1,
		active: 2,
		rejected: 3,
		deleted: 9,
	}),
	getSellerDetail: async () => ({ ...profile, user, organization }),
	listSellers: async (query: unknown) => {
		calls.push([query]);
		return {
			data: [{ ...profile, user, organization }],
			pagination: { page: 1, limit: 5, total: 1, offset: 0 },
		};
	},
	verifySeller: async (...args: unknown[]) => {
		calls.push(args);
		return profile;
	},
	rejectSeller: async (...args: unknown[]) => {
		calls.push(args);
		return profile;
	},
	listPendingChanges: async () => ({ data: [], pagination: {} }),
	approveChange: async () => ({}),
	rejectChange: async (params: unknown) => {
		calls.push([params]);
		return {
			id: "c1",
			sellerProfileId: "s1",
			changeType: "vat",
			changeData: { vatNumber: "1" },
			status: "rejected",
			reviewedBy: "admin-1",
			reviewedAt: at,
			rejectionReason: null,
			createdAt: at,
			reviewNote: "interna",
		};
	},
}));

const snapshot = {
	documentType: "passport",
	documentNumber: "YA1",
	documentExpiry: "2030-01-01",
	issuedMunicipality: { name: "Bologna", provinceAcronym: "BO", id: "m1" },
	imageUrl: null,
	imageKey: "documents/s1/segreto",
};

mock.module("@/modules/admin/services/requests", () => ({
	listRequests: async (query: unknown) => {
		calls.push([query]);
		return { data: [], pagination: { page: 1, limit: 20, total: 0 } };
	},
	countRequests: async () => ({}),
	getChangeDetail: async () => ({
		id: "c1",
		changeType: "document",
		status: "pending",
		createdAt: at,
		changeData: { documentImageKey: "documents/s1/segreto" },
		seller: {
			id: "s1",
			name: "Anna Rossi",
			email: "anna@test.com",
			businessName: null,
			userId: "u1",
		},
		vat: null,
		document: { current: snapshot, requested: snapshot },
	}),
}));

mock.module("@/modules/admin/services/billing", () => ({
	getBillingOverview: async () => ({}),
	getCurrentPricing: async () => ({}),
	listPricingHistory: async () => [],
	updatePricing: async (input: unknown) => {
		calls.push([input]);
		return { newPriceId: "price_1", stripeProductId: "prod_interno" };
	},
	listAllSubscriptions: async (query: unknown) => {
		calls.push([query]);
		return {
			data: [
				{
					id: "sub1",
					storeId: "st1",
					storeName: "Bottega",
					sellerEmail: "anna@test.com",
					status: "active",
					feeAmountCents: 2900,
					currentPeriodEnd: at,
					createdAt: at,
					cancelReason: null,
					stripeSubscriptionId: "sub_segreto",
				},
			],
			pagination: { page: 1, limit: 25, total: 1, offset: 0 },
		};
	},
}));

const { adminApp } = await import("@/modules/admin");
const admin = withVars(adminApp, { user: { id: "admin-1", role: "admin" } });

const json = (method: string, body: unknown) => ({
	method,
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
});

beforeEach(() => {
	calls.length = 0;
});

describe("admin 2 su Hono: strip in ingresso", () => {
	it("rifiuto: campi ignoti fuori, motivo trimmato, data decodificata", async () => {
		const res = await admin.request(
			"/sellers/s1/reject",
			json("PATCH", {
				reason: " Documento illeggibile ",
				fixStep: "document",
				expectedUpdatedAt: iso,
				onboardingStatus: "active",
			}),
		);
		expect(res.status).toBe(200);
		expect(calls).toEqual([
			["s1", at, { reason: "Documento illeggibile", fixStep: "document" }],
		]);
	});

	it("verifica: solo expectedUpdatedAt arriva al servizio", async () => {
		const res = await admin.request(
			"/sellers/s1/verify",
			json("PATCH", { expectedUpdatedAt: iso, force: true }),
		);
		expect(res.status).toBe(200);
		expect(calls).toEqual([["s1", at]]);
	});

	it("prezzi: i campi ignoti non arrivano a Stripe", async () => {
		const res = await admin.request(
			"/billing/pricing",
			json("PUT", {
				storeMonthlyFeeCents: 2900,
				currency: "EUR",
				suspendedAutoCancelDays: 60,
				pendingCreationExpiryHours: 24,
				productId: "prod_ABC123",
				stripePriceId: "price_altro",
			}),
		);
		expect(res.status).toBe(200);
		expect(calls).toEqual([
			[
				{
					storeMonthlyFeeCents: 2900,
					currency: "EUR",
					suspendedAutoCancelDays: 60,
					pendingCreationExpiryHours: 24,
					productId: "prod_ABC123",
					adminUserId: "admin-1",
				},
			],
		]);
		expect(await res.json()).toEqual({
			success: true,
			data: { newPriceId: "price_1" },
		});
	});

	it("rifiuto di una modifica: campi ignoti fuori", async () => {
		const res = await admin.request(
			"/sellers/changes/c1/reject",
			json("PATCH", { reason: "no", status: "approved" }),
		);
		expect(res.status).toBe(200);
		expect(calls).toEqual([
			[{ changeId: "c1", adminUserId: "admin-1", reason: "no" }],
		]);
		const body = await res.json();
		expect(body.data).not.toHaveProperty("reviewNote");
		expect(body.data.reviewedAt).toBe(iso);
	});

	it("query: i parametri ignoti non arrivano al servizio, i default sì", async () => {
		await admin.request("/sellers?limit=5&ownerId=x");
		await admin.request("/requests?type=vat&x=1");
		await admin.request("/billing/subscriptions?status=active&x=1");
		expect(calls).toEqual([
			[{ page: 1, limit: 5, sortBy: "createdAt", sortOrder: "desc" }],
			[{ page: 1, limit: 20, type: "vat" }],
			[
				{
					page: 1,
					limit: 25,
					status: "active",
					sellerEmail: undefined,
					storeName: undefined,
				},
			],
		]);
	});
});

describe("admin 2 su Hono: strip in uscita", () => {
	it("dettaglio venditore: colonne interne di profilo, utente e organizzazione fuori", async () => {
		const res = await admin.request("/sellers/s1");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data).not.toHaveProperty("documentImageKey");
		expect(data.residenceMunicipality).toEqual(municipality);
		expect(data.user).not.toHaveProperty("stripeCustomerId");
		expect(data.organization).not.toHaveProperty("stripeAccountId");
		expect(data.organization.municipality).toEqual(municipality);
		expect(data.updatedAt).toBe(iso);
	});

	it("lista venditori e contatori: niente campi in più", async () => {
		const list = await (await admin.request("/sellers?limit=5")).json();
		expect(list.data[0]).not.toHaveProperty("documentImageKey");
		expect(list.data[0].user).not.toHaveProperty("stripeCustomerId");
		expect(list.pagination).toEqual({ page: 1, limit: 5, total: 1 });
		const counts = await (await admin.request("/sellers/counts")).json();
		expect(counts.data).toEqual({ pending_review: 1, active: 2, rejected: 3 });
	});

	it("dettaglio richiesta: chiavi S3 e dati grezzi fuori, anche nei documenti", async () => {
		const { data } = await (await admin.request("/requests/changes/c1")).json();
		expect(data).not.toHaveProperty("changeData");
		expect(data.seller).not.toHaveProperty("userId");
		for (const side of [data.document.current, data.document.requested]) {
			expect(side).not.toHaveProperty("imageKey");
			expect(side.issuedMunicipality).toEqual({
				name: "Bologna",
				provinceAcronym: "BO",
			});
		}
	});

	it("abbonamenti: id Stripe fuori dalle righe, offset fuori dalla paginazione", async () => {
		const { data } = await (
			await admin.request("/billing/subscriptions")
		).json();
		expect(data.data[0]).not.toHaveProperty("stripeSubscriptionId");
		expect(data.data[0].currentPeriodEnd).toBe(iso);
		expect(data.pagination).toEqual({ page: 1, limit: 25, total: 1 });
	});
});
