import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { settingsRoutes } from "@/modules/seller/routes/settings";
import { errorHandler } from "@/plugins/error-handler";

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

// Mounted bare (no seller guard) → withSeller(ctx).isOwner is undefined,
// so requireOwner must produce a 403 before the handler runs. Bodies are
// valid on purpose: a 422 from validation would pass for the wrong reason.
const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.use(settingsRoutes);

async function call(method: string, path: string, body?: unknown) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method,
			...(body
				? {
						body: JSON.stringify(body),
						headers: { "content-type": "application/json" },
					}
				: {}),
		}),
	);
}

const PERSONAL = {
	firstName: "Mario",
	lastName: "Rossi",
	citizenship: "IT",
	birthCountry: "IT",
	birthDate: "1980-01-01",
	residenceCountry: "IT",
	residenceMunicipalityId: "some-municipality",
	residenceAddress: "Via Roma 1",
	residenceZipCode: "00100",
};

const COMPANY = {
	businessName: "Rossi SRL",
	legalForm: "SRL",
	addressLine1: "Via Roma 1",
	municipalityId: "some-municipality",
	zipCode: "00100",
};

const DOCUMENT = {
	documentNumber: "CA12345",
	documentExpiry: "2030-01-01",
	documentIssuedMunicipalityId: "some-municipality",
};

describe("seller settings writes are owner-only", () => {
	it("PATCH /settings/personal → 403 for a non-owner", async () => {
		const res = await call("PATCH", "/settings/personal", PERSONAL);
		expect(res.status).toBe(403);
	});

	it("PATCH /settings/company → 403 for a non-owner", async () => {
		const res = await call("PATCH", "/settings/company", COMPANY);
		expect(res.status).toBe(403);
	});

	it("PATCH /settings/vat → 403 for a non-owner", async () => {
		const res = await call("PATCH", "/settings/vat", {
			vatNumber: "12345678901",
		});
		expect(res.status).toBe(403);
	});

	it("PATCH /settings/document → 403 for a non-owner", async () => {
		const res = await call("PATCH", "/settings/document", DOCUMENT);
		expect(res.status).toBe(403);
	});

	// Not a guard case: validation runs first, so an impossible date is a 422
	// before requireOwner can answer 403.
	it("PATCH /settings/personal with an impossible birthDate → 422", async () => {
		const res = await call("PATCH", "/settings/personal", {
			...PERSONAL,
			birthDate: "2024-02-30",
		});
		expect(res.status).toBe(422);
	});
});
