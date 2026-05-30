import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { ok } from "@/lib/responses";
import {
	okRes,
	RegisterCustomerResult,
	RegisterSellerResult,
	SignInResult,
} from "@/lib/schemas";

// The registration/sign-in handlers return RAW database rows (no joined
// municipalities, plus columns like updatedAt / documentImageKey / stripeCustomerId).
// These tests feed representative raw rows through the new response schemas using
// Elysia's real normalization pipeline, proving the schemas accept the actual
// shapes (so they won't 500 at runtime) without needing a database.

const now = new Date();

const rawUser = {
	id: "u1",
	name: "mario",
	email: "mario@x.it",
	emailVerified: false,
	image: null,
	createdAt: now,
	updatedAt: now,
	role: "customer",
	banned: null,
	banReason: null,
	banExpires: null,
	// additionalFields present on the raw row, not in UserSchema → must be stripped
	firstName: null,
	lastName: null,
	birthDate: null,
};

const rawCustomerProfile = {
	id: "c1",
	userId: "u1",
	points: 0,
	createdAt: now,
	updatedAt: now, // not in CustomerProfileSchema → must be stripped
};

const rawSellerProfile = {
	id: "s1",
	userId: "u1",
	onboardingStatus: "pending_email" as const,
	firstName: null,
	lastName: null,
	citizenship: null,
	birthCountry: null,
	birthDate: null,
	residenceCountry: null,
	residenceMunicipalityId: null,
	residenceAddress: null,
	residenceZipCode: null,
	documentNumber: null,
	documentExpiry: null,
	documentIssuedMunicipalityId: null,
	documentImageUrl: null,
	vatChangeBlocked: false,
	// extra raw columns not in the schema → must be stripped
	documentImageKey: null,
	stripeCustomerId: null,
	createdAt: now,
	updatedAt: now,
};

const rawOrganization = {
	id: "o1",
	sellerProfileId: "s1",
	businessName: "Acme",
	vatNumber: "IT12345678901",
	legalForm: "SRL",
	addressLine1: "Via Roma 1",
	country: "IT",
	municipalityId: "m1",
	zipCode: "00100",
	vatStatus: "pending" as const,
	createdAt: now,
	updatedAt: now,
};

const app = new Elysia()
	.post(
		"/customer",
		() => ok({ user: rawUser, profile: rawCustomerProfile, token: null }),
		{
			response: { 200: okRes(RegisterCustomerResult) },
		},
	)
	.post(
		"/seller",
		() =>
			ok({
				user: { ...rawUser, role: "seller" },
				profile: rawSellerProfile,
				token: "tok",
			}),
		{ response: { 200: okRes(RegisterSellerResult) } },
	)
	.post(
		"/sign-in",
		() =>
			ok({
				user: rawUser,
				profiles: { customer: rawCustomerProfile, seller: rawSellerProfile },
				organization: rawOrganization,
				token: "tok",
			}),
		{ response: { 200: okRes(SignInResult) } },
	);

function post(path: string) {
	return app.handle(new Request(`http://localhost${path}`, { method: "POST" }));
}

describe("registration response schemas accept the raw DB rows", () => {
	it("validates the /register/customer payload (200)", async () => {
		const res = await post("/customer");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { user: { id: string } } };
		expect(body.data.user.id).toBe("u1");
	});

	it("validates the /register/seller payload with a raw seller profile (200)", async () => {
		const res = await post("/seller");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: {
				profile: Record<string, unknown>;
				user: Record<string, unknown>;
			};
		};
		expect(body.data.profile.onboardingStatus).toBe("pending_email");
		// Sensitive / internal raw columns must be stripped, not leaked.
		expect("documentImageKey" in body.data.profile).toBe(false);
		expect("stripeCustomerId" in body.data.profile).toBe(false);
		expect("updatedAt" in body.data.profile).toBe(false);
		expect("firstName" in body.data.user).toBe(false);
		expect("birthDate" in body.data.user).toBe(false);
	});

	it("validates the /sign-in payload with raw seller profile + organization (200)", async () => {
		const res = await post("/sign-in");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { organization: { businessName: string } | null };
		};
		expect(body.data.organization?.businessName).toBe("Acme");
	});
});
