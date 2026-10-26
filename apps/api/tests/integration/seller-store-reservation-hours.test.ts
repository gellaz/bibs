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
import { holidayDefinition } from "@/db/schemas/holiday-definition";
import { sellerProfile } from "@/db/schemas/seller";
import { store as storeTable } from "@/db/schemas/store";
import { reservationDeadline } from "@/lib/holidays";
import { resolveReservationDeadlines } from "@/lib/store-open-status";
import { storesRoutes } from "@/modules/seller/routes/stores";
import { truncateAll } from "../helpers/cleanup";
import { createTestSeller, createTestStore } from "../helpers/fixtures";
import { withVars } from "../helpers/hono-app";

beforeAll(async () => {
	await setupTestContainer();
}, 120_000);
afterAll(async () => {
	await teardownTestContainer();
});
beforeEach(async () => {
	await truncateAll(getTestDb());
});

// Il guard del seller è sostituito da una resolve di test: `x-seller` è l'id
// del profilo, `x-owner: 0` simula un dipendente.
const app = withVars(storesRoutes, async (request) => {
	const id = request.headers.get("x-seller") ?? "";
	const sp = await getTestDb().query.sellerProfile.findFirst({
		where: eq(sellerProfile.id, id),
	});
	if (!sp) throw new Error("test seller missing");
	return {
		user: { id: sp.userId },
		seller: {
			sellerProfile: sp,
			isOwner: request.headers.get("x-owner") !== "0",
		},
	};
});

const openingHours = Array.from({ length: 7 }, (_, i) => ({
	dayOfWeek: i,
	slots: [{ open: "08:00", close: "20:00" }],
}));

async function setup(withHours = true) {
	const db = getTestDb();
	const seller = await createTestSeller(db);
	const store = await createTestStore(db, seller.profile.id, {
		openingHours: withHours ? openingHours : undefined,
	});
	return { sellerProfileId: seller.profile.id, storeId: store.id };
}

const patch = (
	s: { sellerProfileId: string; storeId: string },
	body: object,
	owner = true,
) =>
	app.request(
		new Request(`http://localhost/stores/${s.storeId}`, {
			method: "PATCH",
			headers: {
				"content-type": "application/json",
				"x-seller": s.sellerProfileId,
				"x-owner": owner ? "1" : "0",
			},
			body: JSON.stringify(body),
		}),
	);

const preview = (
	s: { sellerProfileId: string; storeId: string },
	hours: string,
	owner = true,
) =>
	app.request(
		new Request(
			`http://localhost/stores/${s.storeId}/reservation-preview?hours=${hours}`,
			{
				headers: {
					"x-seller": s.sellerProfileId,
					"x-owner": owner ? "1" : "0",
				},
			},
		),
	);

const savedHours = async (storeId: string) =>
	(
		await getTestDb().query.store.findFirst({
			where: eq(storeTable.id, storeId),
			columns: { reservationHours: true },
		})
	)?.reservationHours;

describe("ore di ritiro del negozio", () => {
	it("un negozio nuovo parte da 24", async () => {
		const s = await setup();
		expect(await savedHours(s.storeId)).toBe(24);
	});

	for (const value of [1, 72]) {
		it(`PATCH accetta ${value}`, async () => {
			const s = await setup();
			const res = await patch(s, { reservationHours: value });
			expect(res.status).toBe(200);
			expect((await res.json()).data.reservationHours).toBe(value);
			expect(await savedHours(s.storeId)).toBe(value);
		});
	}

	for (const value of [0, 73, 1.5]) {
		it(`PATCH rifiuta ${value}`, async () => {
			const s = await setup();
			const res = await patch(s, { reservationHours: value });
			expect(res.status).toBe(422);
			expect(await savedHours(s.storeId)).toBe(24);
		});
	}

	it("PATCH da dipendente → 403, valore invariato", async () => {
		const s = await setup();
		const res = await patch(s, { reservationHours: 48 }, false);
		expect(res.status).toBe(403);
		expect(await savedHours(s.storeId)).toBe(24);
	});
});

describe("anteprima della scadenza", () => {
	it("usa il valore non salvato e non scrive nulla", async () => {
		const s = await setup();
		const deadline = (from: Date) =>
			reservationDeadline({
				openingHours,
				closedDates: new Set(),
				from,
				hours: 3,
			}).expiresAt.getTime();

		const before = new Date();
		const res = await preview(s, "3");
		const after = new Date();

		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.hours).toBe(3);
		expect(data.clock).toBe("opening");
		const expiresAt = new Date(data.expiresAt).getTime();
		expect(expiresAt).toBeGreaterThanOrEqual(deadline(before));
		expect(expiresAt).toBeLessThanOrEqual(deadline(after));
		expect(await savedHours(s.storeId)).toBe(24);
	});

	it("negozio senza orari → calendario", async () => {
		const s = await setup(false);
		const res = await preview(s, "24");
		expect(res.status).toBe(200);
		expect((await res.json()).data.clock).toBe("calendar");
	});

	it("rifiuta i dipendenti", async () => {
		const s = await setup();
		const res = await preview(s, "24", false);
		expect(res.status).toBe(403);
	});

	it("rifiuta hours=0", async () => {
		const s = await setup();
		const res = await preview(s, "0");
		expect(res.status).toBe(422);
	});
});

describe("scadenza dentro una transazione", () => {
	it("legge festività e opt-out con la tx passata", async () => {
		// Mercoledì 21 ottobre 2026, 10:00 a Roma.
		const now = new Date("2026-10-21T10:00:00+02:00");
		const s = {
			id: crypto.randomUUID(),
			openingHours,
			closures: null,
			reservationHours: 1,
		};
		await getTestDb().transaction(async (tx) => {
			// Non ancora committata: la vede solo chi legge con la tx.
			await tx.insert(holidayDefinition).values({
				name: "Chiusura di prova",
				type: "one_off",
				oneOffDate: "2026-10-21",
			});
			const deadlines = await resolveReservationDeadlines([s], now, tx);
			// Oggi festivo: si riparte giovedì alle 8, scade alle 9.
			expect(deadlines.get(s.id)?.expiresAt).toEqual(
				new Date("2026-10-22T09:00:00+02:00"),
			);
		});
	});
});
