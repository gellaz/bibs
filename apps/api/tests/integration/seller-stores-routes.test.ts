import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
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
mock.module("@/lib/email", () => ({ sendEmail: async () => {} }));

const s3WriteMock = mock(async (_key: string, _data: unknown) => {});
const s3DeleteMock = mock(async (_key: string) => {});
mock.module("@/lib/s3", () => ({
	s3: { write: s3WriteMock, delete: s3DeleteMock },
	publicUrl: (key: string) => `http://localhost:9000/bibs-test/${key}`,
	ensureBucket: async () => {},
	checkBucket: async () => true,
}));

import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { storeEmployee, storeEmployeeStores } from "@/db/schemas/employee";
import { type OnboardingStatus, sellerProfile } from "@/db/schemas/seller";
import { store as storeTable } from "@/db/schemas/store";
import * as settingsService from "@/modules/seller/services/settings";
import { errorHandler } from "@/plugins/error-handler";
import { normalize } from "@/plugins/normalize";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestMunicipality,
	createTestOrganization,
	createTestStore,
	createTestStoreImage,
} from "../helpers/fixtures";
import { signIn } from "../helpers/hono-app";

// Le route di U6 (negozi, immagini dei negozi, chiusure, impostazioni, team,
// onboarding, profilo; la dashboard ha il suo test) con sessioni better-auth
// vere: le due guardie (ruolo seller per profilo e onboarding, contesto
// seller per il resto) dopo la validazione, scritture, multipart, strip in
// ingresso e in uscita. Nato contro `sellerModule` (Elysia, prima della
// migrazione a Hono): da allora cambia solo `call()`.

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

let app: { handle: (req: Request) => Promise<Response> };

beforeAll(async () => {
	await setupTestContainer();
	// dinamico: @/lib/auth cattura `db` alla valutazione
	const { sellerModule } = await import("@/modules/seller");
	app = new Elysia()
		.state("pino", noopPino)
		.use(errorHandler)
		.use(normalize)
		.use(sellerModule);
}, 180_000);

afterAll(async () => {
	await teardownTestContainer();
});

beforeEach(async () => {
	await truncateAll(getTestDb());
	s3WriteMock.mockClear();
	s3DeleteMock.mockClear();
});

/** Una richiesta a /seller<path>. */
function call(path: string, init: RequestInit = {}) {
	return app.handle(new Request(`http://localhost/seller${path}`, init));
}

const json = (method: string, body: unknown, cookie?: string) => ({
	method,
	headers: {
		"content-type": "application/json",
		...(cookie ? { cookie } : {}),
	},
	body: JSON.stringify(body),
});

const as = (cookie: string, init: RequestInit = {}) => ({
	...init,
	headers: { ...(init.headers as Record<string, string>), cookie },
});

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);
const png = (name: string) => new File([PNG], name, { type: "image/png" });

const fail = (error: string, message: string) => ({
	success: false,
	error,
	message,
});

let seq = 0;
const email = (role: string) => `u6-${role}-${++seq}@test.com`;

/** Titolare con sessione e profilo venditore nello stato `status`. */
async function owner(status: OnboardingStatus = "active") {
	const s = await signIn(email("seller"), "seller");
	const [profile] = await getTestDb()
		.insert(sellerProfile)
		.values({ userId: s.userId, onboardingStatus: status })
		.returning();
	return { ...s, profileId: profile.id };
}

/** Dipendente con sessione, incarico attivo e i negozi dati. */
async function employee(sellerProfileId: string, storeIds: string[]) {
	const s = await signIn(email("employee"), "employee");
	const [emp] = await getTestDb()
		.insert(storeEmployee)
		.values({ sellerProfileId, userId: s.userId, status: "active" })
		.returning();
	if (storeIds.length)
		await getTestDb()
			.insert(storeEmployeeStores)
			.values(
				storeIds.map((storeId) => ({ storeEmployeeId: emp.id, storeId })),
			);
	return { ...s, employeeId: emp.id };
}

const ISO = expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);

const PERSONAL = {
	firstName: "Mario",
	lastName: "Rossi",
	citizenship: "IT",
	birthCountry: "IT",
	birthDate: "1980-01-01",
	residenceCountry: "IT",
	residenceAddress: "Via Roma 1",
	residenceZipCode: "00100",
};

const DOCUMENT = {
	documentType: "identity_card",
	documentNumber: "CA12345AB",
	documentExpiry: "2035-01-01",
};

const COMPANY = {
	businessName: "Rossi SRL",
	legalForm: "SRL",
	addressLine1: "Via Roma 1",
	zipCode: "00100",
};

const hours = [{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }] }];

describe("guardia di ruolo: profilo e onboarding", () => {
	it("anonimo: 401, ma 422 se il body non è valido (validazione prima)", async () => {
		const res = await call("/profile");
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual(
			fail("UNAUTHORIZED", "Devi accedere per continuare"),
		);
		const bad = await call("/onboarding/personal-info", json("PATCH", {}));
		expect(bad.status).toBe(422);
		expect(await bad.json()).toEqual(
			fail("VALIDATION_ERROR", "Il nome è obbligatorio"),
		);
	});

	it("cliente e dipendente: 403 dopo la validazione", async () => {
		const customer = await signIn(email("customer"), "customer");
		const res = await call("/profile", as(customer.cookie));
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual(
			fail("FORBIDDEN", "Accesso riservato ai venditori"),
		);
		const bad = await call(
			"/onboarding/personal-info",
			json("PATCH", {}, customer.cookie),
		);
		expect(bad.status).toBe(422);

		const o = await owner();
		const emp = await employee(o.profileId, []);
		const status = await call("/onboarding/status", as(emp.cookie));
		expect(status.status).toBe(403);
		expect(await status.json()).toEqual(
			fail("FORBIDDEN", "Accesso riservato ai venditori"),
		);
	});

	it("venditore in onboarding: profilo e stato sì, le route operative no", async () => {
		const o = await owner("pending_personal");
		const status = await call("/onboarding/status", as(o.cookie));
		expect(status.status).toBe(200);
		expect(await status.json()).toEqual({
			success: true,
			data: expect.objectContaining({
				id: o.profileId,
				onboardingStatus: "pending_personal",
				supportEmail: expect.any(String),
				createdAt: ISO,
			}),
		});
		const profile = await call("/profile", as(o.cookie));
		expect(profile.status).toBe(200);
		const stores = await call("/stores", as(o.cookie));
		expect(stores.status).toBe(403);
		expect(await stores.json()).toEqual(
			fail("FORBIDDEN", "Onboarding del venditore non completato"),
		);
	});
});

describe("onboarding", () => {
	it("i tre passi, il documento in multipart e il passo indietro", async () => {
		const o = await owner("pending_personal");
		const m = await createTestMunicipality(getTestDb());

		const personal = await call(
			"/onboarding/personal-info",
			json(
				"PATCH",
				{ ...PERSONAL, firstName: "  Mario  ", residenceMunicipalityId: m.id },
				o.cookie,
			),
		);
		expect(personal.status).toBe(200);
		const p = (await personal.json()) as any;
		expect(p.data).toMatchObject({
			onboardingStatus: "pending_document",
			firstName: "Mario",
			residenceMunicipality: { id: m.id },
		});

		const back = await call(
			"/onboarding/go-back",
			as(o.cookie, { method: "POST" }),
		);
		expect(back.status).toBe(200);
		expect(((await back.json()) as any).data.onboardingStatus).toBe(
			"pending_personal",
		);
		await call(
			"/onboarding/personal-info",
			json("PATCH", { ...PERSONAL, residenceMunicipalityId: m.id }, o.cookie),
		);

		const notImage = new FormData();
		for (const [k, v] of Object.entries(DOCUMENT)) notImage.append(k, v);
		notImage.append("documentIssuedMunicipalityId", m.id);
		notImage.append(
			"documentImage",
			new File(["ciao"], "doc.png", { type: "image/png" }),
		);
		const bad = await call(
			"/onboarding/document",
			as(o.cookie, { method: "PATCH", body: notImage }),
		);
		expect(bad.status).toBe(422);
		expect(await bad.json()).toEqual(
			fail(
				"VALIDATION_ERROR",
				"Immagine del documento: tipo di file non ammesso",
			),
		);

		const form = new FormData();
		for (const [k, v] of Object.entries(DOCUMENT)) form.append(k, v);
		form.append("documentIssuedMunicipalityId", m.id);
		form.append("documentImage", png("doc.png"));
		const doc = await call(
			"/onboarding/document",
			as(o.cookie, { method: "PATCH", body: form }),
		);
		expect(doc.status).toBe(200);
		expect(((await doc.json()) as any).data).toMatchObject({
			onboardingStatus: "pending_company",
			documentType: "identity_card",
			documentNumber: "CA12345AB",
			documentImageUrl: expect.stringContaining("http://localhost:9000/"),
		});
		expect(s3WriteMock).toHaveBeenCalledTimes(1);

		const company = await call(
			"/onboarding/company",
			json(
				"PATCH",
				{ ...COMPANY, vatNumber: "12345678901", municipalityId: m.id },
				o.cookie,
			),
		);
		expect(company.status).toBe(200);
		expect(((await company.json()) as any).data.onboardingStatus).toBe(
			"pending_review",
		);
	});
});

describe("negozi", () => {
	it("crea, legge, modifica: intero come stringa, telefoni e orari", async () => {
		const o = await owner();
		const m = await createTestMunicipality(getTestDb());
		const created = await call(
			"/stores",
			json(
				"POST",
				{
					name: "  Bottega U6  ",
					addressLine1: "Via Roma 1",
					municipalityId: m.id,
					zipCode: "40100",
					location: { x: 11.34, y: 44.49 },
					openingHours: hours,
					phoneNumbers: [{ number: "051123456", label: "Principale" }],
					websiteUrl: null,
				},
				o.cookie,
			),
		);
		expect(created.status).toBe(200);
		const store = ((await created.json()) as any).data;
		expect(store).toMatchObject({
			name: "Bottega U6",
			sellerProfileId: o.profileId,
			municipality: { id: m.id },
			location: { x: 11.34, y: 44.49 },
			openingHours: hours,
			phoneNumbers: [{ number: "051123456", label: "Principale", position: 0 }],
			images: [],
			category: null,
			reservationHours: 24,
			lowStockThreshold: expect.any(Number),
			createdAt: ISO,
		});

		const patched = await call(
			`/stores/${store.id}`,
			json(
				"PATCH",
				{
					reservationHours: "48",
					lowStockThreshold: 3,
					phoneNumbers: [{ number: "051999999", position: "2" }],
					openingHours: null,
				},
				o.cookie,
			),
		);
		expect(patched.status).toBe(200);
		expect(((await patched.json()) as any).data).toMatchObject({
			reservationHours: 48,
			lowStockThreshold: 3,
			phoneNumbers: [{ number: "051999999", position: 2, label: null }],
			openingHours: null,
		});

		const list = await call("/stores?page=1&limit=10", as(o.cookie));
		expect(list.status).toBe(200);
		expect(await list.json()).toMatchObject({
			success: true,
			data: [{ id: store.id }],
			pagination: { page: 1, limit: 10, total: 1 },
		});

		const missing = await call(
			"/stores/00000000-0000-4000-8000-000000000000",
			json("PATCH", { name: "x" }, o.cookie),
		);
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual(
			fail("NOT_FOUND", "Negozio non trovato"),
		);
	});

	it("dipendente: vede i suoi negozi, le scritture del titolare sono 403", async () => {
		const o = await owner();
		const mine = await createTestStore(getTestDb(), o.profileId, {
			name: "Assegnato",
		});
		await createTestStore(getTestDb(), o.profileId, { name: "Altro" });
		const emp = await employee(o.profileId, [mine.id]);
		const list = await call("/stores", as(emp.cookie));
		expect(list.status).toBe(200);
		const body = (await list.json()) as any;
		expect(body.data.map((s: any) => s.name)).toEqual(["Assegnato"]);
		const write = await call(
			`/stores/${mine.id}`,
			json("PATCH", { name: "Nuovo" }, emp.cookie),
		);
		expect(write.status).toBe(403);
		expect(await write.json()).toEqual(
			fail("FORBIDDEN", "Solo il titolare può eseguire questa operazione"),
		);
	});

	it("tipologie, anteprima della scadenza, chiusure e archivio", async () => {
		const o = await owner();
		const s = await createTestStore(getTestDb(), o.profileId, {
			openingHours: Array.from({ length: 7 }, (_, i) => ({
				dayOfWeek: i,
				slots: [{ open: "08:00", close: "20:00" }],
			})),
		});
		const types = await call(`/stores/${s.id}/order-types`, as(o.cookie));
		expect(types.status).toBe(200);
		expect(await types.json()).toEqual({
			success: true,
			data: {
				orderTypes: ["reserve_pickup"],
				offeredOrderTypes: ["reserve_pickup"],
				chargesEnabled: false,
				vatChangeBlocked: false,
			},
		});
		const payPickup = await call(
			`/stores/${s.id}/order-types`,
			json("PATCH", { orderTypes: ["reserve_pickup", "pay_pickup"] }, o.cookie),
		);
		expect(payPickup.status).toBe(400);

		const preview = await call(
			`/stores/${s.id}/reservation-preview?hours=24`,
			as(o.cookie),
		);
		expect(preview.status).toBe(200);
		expect(await preview.json()).toEqual({
			success: true,
			data: { hours: 24, expiresAt: ISO, clock: "opening" },
		});

		const put = await call(
			`/stores/${s.id}/closures`,
			json(
				"PUT",
				{
					optOutIds: [],
					customClosures: [
						{ startDate: "2099-08-10", endDate: "2099-08-20", note: " Ferie " },
					],
				},
				o.cookie,
			),
		);
		expect(put.status).toBe(200);
		expect(((await put.json()) as any).data.customClosures).toEqual([
			{ startDate: "2099-08-10", endDate: "2099-08-20", note: "Ferie" },
		]);
		const closures = await call(`/stores/${s.id}/closures`, as(o.cookie));
		expect(closures.status).toBe(200);

		const archived = await call("/stores/archived", as(o.cookie));
		expect(archived.status).toBe(200);
		expect(await archived.json()).toEqual({
			success: true,
			data: { data: [], pagination: { page: 1, limit: 25, total: 0 } },
		});

		const cancel = await call(
			`/stores/${s.id}`,
			as(o.cookie, { method: "DELETE" }),
		);
		expect(cancel.status).toBe(404);
		expect(await cancel.json()).toEqual(
			fail("NOT_FOUND", "Abbonamento non trovato"),
		);
		const reactivate = await call(
			`/stores/${s.id}/reactivate`,
			as(o.cookie, { method: "POST" }),
		);
		expect(reactivate.status).toBe(404);
	});
});

describe("immagini del negozio", () => {
	it("più file, un file, posizione come stringa, file non immagine, eliminazione", async () => {
		const o = await owner();
		const s = await createTestStore(getTestDb(), o.profileId);

		const two = new FormData();
		two.append("files", png("a.png"));
		two.append("files", png("b.png"));
		const res = await call(
			`/stores/${s.id}/images`,
			as(o.cookie, { method: "POST", body: two }),
		);
		expect(res.status).toBe(200);
		const images = ((await res.json()) as any).data;
		expect(images).toHaveLength(2);
		expect(images[0]).toMatchObject({
			storeId: s.id,
			url: expect.stringContaining("http://localhost:9000/"),
			createdAt: ISO,
		});

		const one = new FormData();
		one.append("files", png("c.png"));
		one.append("position", "5");
		const single = await call(
			`/stores/${s.id}/images`,
			as(o.cookie, { method: "POST", body: one }),
		);
		expect(single.status).toBe(200);
		expect(((await single.json()) as any).data).toMatchObject([
			{ position: 5 },
		]);

		const text = new FormData();
		text.append("files", new File(["ciao"], "a.png", { type: "image/png" }));
		const bad = await call(
			`/stores/${s.id}/images`,
			as(o.cookie, { method: "POST", body: text }),
		);
		expect(bad.status).toBe(422);
		expect(await bad.json()).toEqual(
			fail("VALIDATION_ERROR", "File: tipo di file non ammesso"),
		);

		const del = await call(
			`/stores/${s.id}/images/${images[0].id}`,
			as(o.cookie, { method: "DELETE" }),
		);
		expect(del.status).toBe(200);
		expect(await del.json()).toEqual({
			success: true,
			message: "Immagine eliminata",
			data: null,
		});
		const again = await call(
			`/stores/${s.id}/images/${images[0].id}`,
			as(o.cookie, { method: "DELETE" }),
		);
		expect(again.status).toBe(404);
	});
});

describe("impostazioni", () => {
	it("lettura (anche con lo slash), dati anagrafici, azienda, partita IVA e documento", async () => {
		const o = await owner();
		const org = await createTestOrganization(getTestDb(), o.profileId, {
			vatStatus: "verified",
		});
		const m = await createTestMunicipality(getTestDb());

		for (const path of ["/settings", "/settings/"]) {
			const res = await call(path, as(o.cookie));
			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({
				success: true,
				data: {
					profile: { id: o.profileId },
					organization: { id: org.id },
					pendingChanges: [],
					assignedStoreIds: null,
				},
			});
		}

		const personal = await call(
			"/settings/personal",
			json("PATCH", { ...PERSONAL, residenceMunicipalityId: m.id }, o.cookie),
		);
		expect(personal.status).toBe(200);
		expect(((await personal.json()) as any).data).toMatchObject({
			firstName: "Mario",
			residenceMunicipality: { id: m.id },
		});

		const company = await call(
			"/settings/company",
			json(
				"PATCH",
				{ ...COMPANY, businessName: "Nuova SRL", municipalityId: m.id },
				o.cookie,
			),
		);
		expect(company.status).toBe(200);
		expect(((await company.json()) as any).data).toMatchObject({
			businessName: "Nuova SRL",
			vatNumber: org.vatNumber,
		});

		const vat = await call(
			"/settings/vat",
			json("PATCH", { vatNumber: "98765432109" }, o.cookie),
		);
		expect(vat.status).toBe(200);
		const change = ((await vat.json()) as any).data;
		expect(change).toMatchObject({
			changeType: "vat",
			status: "pending",
			reviewedAt: null,
			createdAt: ISO,
		});
		const twice = await call(
			"/settings/vat",
			json("PATCH", { vatNumber: "98765432109" }, o.cookie),
		);
		expect(twice.status).toBe(409);

		const cancel = await call(
			`/settings/changes/${change.id}/cancel`,
			as(o.cookie, { method: "PATCH" }),
		);
		expect(cancel.status).toBe(200);
		expect(((await cancel.json()) as any).data.status).toBe("cancelled");

		const docJson = await call(
			"/settings/document",
			json(
				"PATCH",
				{ ...DOCUMENT, documentIssuedMunicipalityId: m.id },
				o.cookie,
			),
		);
		expect(docJson.status).toBe(200);
		expect(((await docJson.json()) as any).data).toMatchObject({
			changeType: "document",
			status: "pending",
		});
	});

	it("documento in multipart con la foto; dipendente: negozi assegnati", async () => {
		const o = await owner();
		const m = await createTestMunicipality(getTestDb());
		const form = new FormData();
		for (const [k, v] of Object.entries(DOCUMENT)) form.append(k, v);
		form.append("documentIssuedMunicipalityId", m.id);
		form.append("documentImage", png("doc.png"));
		const res = await call(
			"/settings/document",
			as(o.cookie, { method: "PATCH", body: form }),
		);
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).data.changeType).toBe("document");
		expect(s3WriteMock).toHaveBeenCalledTimes(1);

		const s = await createTestStore(getTestDb(), o.profileId);
		const emp = await employee(o.profileId, [s.id]);
		const settings = await call("/settings", as(emp.cookie));
		expect(settings.status).toBe(200);
		expect(((await settings.json()) as any).data.assignedStoreIds).toEqual([
			s.id,
		]);
	});
});

describe("team", () => {
	it("invito, reinvio, annullamento; lista, negozi, ban e rimozione", async () => {
		const o = await owner();
		const s1 = await createTestStore(getTestDb(), o.profileId, { name: "A" });
		const s2 = await createTestStore(getTestDb(), o.profileId, { name: "B" });

		const invite = await call(
			"/employees/invite",
			json("POST", { email: " nuovo@test.com ", storeIds: [s1.id] }, o.cookie),
		);
		expect(invite.status).toBe(200);
		const invitation = ((await invite.json()) as any).data;
		expect(invitation).toMatchObject({
			email: "nuovo@test.com",
			status: "pending",
			storeIds: [s1.id],
			expiresAt: ISO,
		});
		const list = await call("/employees/invitations", as(o.cookie));
		expect(((await list.json()) as any).data).toHaveLength(1);
		const resend = await call(
			`/employees/invitations/${invitation.id}/resend`,
			as(o.cookie, { method: "POST" }),
		);
		expect(resend.status).toBe(200);
		const cancel = await call(
			`/employees/invitations/${invitation.id}`,
			as(o.cookie, { method: "DELETE" }),
		);
		expect(cancel.status).toBe(200);
		expect(((await cancel.json()) as any).data.status).toBe("expired");

		const emp = await employee(o.profileId, [s1.id]);
		const team = await call("/employees", as(o.cookie));
		expect(team.status).toBe(200);
		expect(await team.json()).toMatchObject({
			success: true,
			data: [{ id: emp.employeeId, status: "active", storeIds: [s1.id] }],
			pagination: { page: 1, limit: 20, total: 1 },
			owner: { id: o.userId },
		});

		const put = await call(
			`/employees/${emp.employeeId}/stores`,
			json("PUT", { storeIds: [s1.id, s2.id] }, o.cookie),
		);
		expect(put.status).toBe(200);
		const stores = await call(
			`/employees/${emp.employeeId}/stores`,
			as(o.cookie),
		);
		expect(
			((await stores.json()) as any).data.map((s: any) => s.name).sort(),
		).toEqual(["A", "B"]);

		const ban = await call(
			`/employees/${emp.employeeId}/ban`,
			as(o.cookie, { method: "PATCH" }),
		);
		expect(((await ban.json()) as any).data.status).toBe("banned");
		const unban = await call(
			`/employees/${emp.employeeId}/unban`,
			as(o.cookie, { method: "PATCH" }),
		);
		expect(((await unban.json()) as any).data.status).toBe("active");
		const removed = await call(
			`/employees/${emp.employeeId}`,
			as(o.cookie, { method: "DELETE" }),
		);
		expect(await removed.json()).toEqual({
			success: true,
			message: "Dipendente rimosso",
			data: null,
		});
	});
});

describe("strip: campi sconosciuti in ingresso e in uscita", () => {
	afterEach(() => mock.restore());

	it("body: un sellerProfileId in più non sposta il negozio né lo crea per un altro", async () => {
		const a = await owner();
		const b = await owner();
		const m = await createTestMunicipality(getTestDb());
		const s = await createTestStore(getTestDb(), a.profileId);

		const patched = await call(
			`/stores/${s.id}`,
			json(
				"PATCH",
				{
					name: "Rinominato",
					sellerProfileId: b.profileId,
					deletedAt: "2020-01-01T00:00:00.000Z",
					phoneNumbers: [{ number: "051123456", storeId: "x", extra: 1 }],
					location: { x: 1, y: 2, z: 3 },
				},
				a.cookie,
			),
		);
		expect(patched.status).toBe(200);
		const row = await getTestDb().query.store.findFirst({
			where: eq(storeTable.id, s.id),
		});
		expect(row).toMatchObject({
			sellerProfileId: a.profileId,
			name: "Rinominato",
			deletedAt: null,
		});
		const data = ((await patched.json()) as any).data;
		expect(data.phoneNumbers[0]).not.toHaveProperty("extra");
		expect(data.location).toEqual({ x: 1, y: 2 });

		const created = await call(
			"/stores",
			json(
				"POST",
				{
					name: "Nuovo",
					addressLine1: "Via Roma 1",
					municipalityId: m.id,
					zipCode: "40100",
					location: { x: 11, y: 44 },
					sellerProfileId: b.profileId,
				},
				a.cookie,
			),
		);
		expect(((await created.json()) as any).data.sellerProfileId).toBe(
			a.profileId,
		);
	});

	it("query: un sellerProfileId in più non apre il team di un altro venditore", async () => {
		const a = await owner();
		const b = await owner();
		const sb = await createTestStore(getTestDb(), b.profileId);
		await employee(b.profileId, [sb.id]);
		const res = await call(
			`/employees?sellerProfileId=${b.profileId}&extra=1`,
			as(a.cookie),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			data: [],
			pagination: { total: 0 },
		});
	});

	it("risposta: colonne fuori schema non escono", async () => {
		const o = await owner();
		const s = await createTestStore(getTestDb(), o.profileId);
		await createTestStoreImage(getTestDb(), s.id);
		const list = await call("/stores", as(o.cookie));
		const store = ((await list.json()) as any).data[0];
		// colonne della tabella stores fuori da StoreWithPhonesSchema
		for (const column of ["deletedAt", "closures", "orderTypes", "location2"])
			expect(store).not.toHaveProperty(column);
		expect(Object.keys(store.images[0]).sort()).toEqual([
			"createdAt",
			"id",
			"key",
			"position",
			"storeId",
			"url",
		]);

		const real = settingsService.getSellerSettings;
		spyOn(settingsService, "getSellerSettings").mockImplementation(
			async (params) => {
				const data = await real(params);
				return {
					...data,
					stripeAccountId: "acct_secret",
					profile: { ...data.profile, documentImageKey: "seller/doc.png" },
				} as typeof data;
			},
		);
		const settings = await call("/settings", as(o.cookie));
		expect(settings.status).toBe(200);
		const text = await settings.text();
		expect(text).not.toContain("acct_secret");
		expect(text).not.toContain("documentImageKey");
	});
});
