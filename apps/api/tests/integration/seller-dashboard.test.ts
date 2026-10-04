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
import { Elysia } from "elysia";
import { user as userTable } from "@/db/schemas/auth";
import type { OrderStatus } from "@/db/schemas/order";
import { order } from "@/db/schemas/order";
import { store as storeTable } from "@/db/schemas/store";
import { resolveSellerAccess } from "@/modules/seller/context";
import { dashboardRoutes } from "@/modules/seller/routes/dashboard";
import { getSellerDashboard } from "@/modules/seller/services/dashboard";
import { errorHandler } from "@/plugins/error-handler";
import { truncateAll } from "../helpers/cleanup";
import {
	createTestCustomer,
	createTestDiscount,
	createTestEmployee,
	createTestProduct,
	createTestSeller,
	createTestStore,
	createTestStoreProduct,
} from "../helpers/fixtures";

const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

// Stessa resolve della guardia seller vera, utente da header.
const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.resolve(async ({ request }) => {
		const id = request.headers.get("x-test-user") ?? "";
		const u = await getTestDb().query.user.findFirst({
			where: eq(userTable.id, id),
		});
		if (!u) throw new Error("test user missing");
		return { user: u, ...(await resolveSellerAccess(u)) };
	})
	.use(dashboardRoutes);

function get(userId: string, path: string) {
	return app.handle(
		new Request(`http://localhost${path}`, {
			headers: { "x-test-user": userId },
		}),
	);
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

async function addOrder(
	storeId: string,
	customerProfileId: string,
	params: { status: OrderStatus; total?: string; createdAt: Date },
) {
	const [row] = await getTestDb()
		.insert(order)
		.values({
			customerProfileId,
			storeId,
			type: "reserve_pickup",
			status: params.status,
			total: params.total ?? "10.00",
			createdAt: params.createdAt,
		})
		.returning();
	return row;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("getSellerDashboard — «oggi» è il giorno Europe/Rome", () => {
	// 00:30 del 16 luglio a Roma (CEST, UTC+2) = 22:30Z del 15 luglio.
	const now = new Date("2026-07-15T22:30:00Z");

	it("conta l'ordine delle 00:05 di Roma e scarta quello delle 23:55 del giorno prima", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const customer = await createTestCustomer(db);

		// 00:05 a Roma del 16: oggi.
		await addOrder(s.id, customer.profile.id, {
			status: "completed",
			total: "12.50",
			createdAt: new Date("2026-07-15T22:05:00Z"),
		});
		// 23:55 a Roma del 15: ieri, anche se è lo stesso giorno UTC di `now`.
		await addOrder(s.id, customer.profile.id, {
			status: "completed",
			total: "99.00",
			createdAt: new Date("2026-07-15T21:55:00Z"),
		});

		const data = await getSellerDashboard({ storeId: s.id, now });
		expect(data.stats.ordersToday).toBe(1);
		expect(data.stats.revenueToday).toBe("12.50");
	});

	it("con l'ora solare (UTC+1) la mezzanotte si sposta di un'ora", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const customer = await createTestCustomer(db);
		// 00:30 del 10 gennaio a Roma = 23:30Z del 9.
		const winterNow = new Date("2026-01-09T23:30:00Z");

		await addOrder(s.id, customer.profile.id, {
			status: "confirmed",
			total: "5.00",
			createdAt: new Date("2026-01-09T23:05:00Z"), // 00:05 Roma → oggi
		});
		await addOrder(s.id, customer.profile.id, {
			status: "confirmed",
			total: "7.00",
			createdAt: new Date("2026-01-09T22:55:00Z"), // 23:55 Roma → ieri
		});

		const data = await getSellerDashboard({ storeId: s.id, now: winterNow });
		expect(data.stats.ordersToday).toBe(1);
		expect(data.stats.revenueToday).toBe("5.00");
	});

	it("un ordine di domani (a Roma) non entra", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const customer = await createTestCustomer(db);

		await addOrder(s.id, customer.profile.id, {
			status: "completed",
			createdAt: new Date("2026-07-16T22:00:00Z"), // 00:00 del 17 a Roma
		});

		const data = await getSellerDashboard({ storeId: s.id, now });
		expect(data.stats.ordersToday).toBe(0);
		expect(data.stats.revenueToday).toBe("0.00");
	});
});

describe("getSellerDashboard — ordini", () => {
	it("esclude annullati, scaduti e in attesa di pagamento da conteggio e fatturato", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const other = await createTestStore(db, seller.profile.id);
		const customer = await createTestCustomer(db);
		const now = new Date();
		const createdAt = new Date(now.getTime() - 60_000);

		await addOrder(s.id, customer.profile.id, {
			status: "confirmed",
			total: "10.00",
			createdAt,
		});
		await addOrder(s.id, customer.profile.id, {
			status: "completed",
			total: "20.25",
			createdAt,
		});
		for (const status of ["cancelled", "expired", "pending"] as const) {
			await addOrder(s.id, customer.profile.id, {
				status,
				total: "500.00",
				createdAt,
			});
		}
		// Altro negozio dello stesso seller: non conta.
		await addOrder(other.id, customer.profile.id, {
			status: "completed",
			total: "70.00",
			createdAt,
		});

		const data = await getSellerDashboard({ storeId: s.id, now });
		expect(data.stats.ordersToday).toBe(2);
		expect(data.stats.revenueToday).toBe("30.25");
	});

	it("ordini da preparare: solo i confermati, con il più vecchio (di qualunque giorno)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const customer = await createTestCustomer(db);
		const now = new Date();
		const oldest = new Date(now.getTime() - 3 * DAY);

		await addOrder(s.id, customer.profile.id, {
			status: "confirmed",
			createdAt: oldest,
		});
		await addOrder(s.id, customer.profile.id, {
			status: "confirmed",
			createdAt: new Date(now.getTime() - HOUR),
		});
		await addOrder(s.id, customer.profile.id, {
			status: "ready_for_pickup",
			createdAt: new Date(now.getTime() - 10 * DAY),
		});
		await addOrder(s.id, customer.profile.id, {
			status: "pending",
			createdAt: new Date(now.getTime() - 10 * DAY),
		});

		const data = await getSellerDashboard({ storeId: s.id, now });
		expect(data.actions.ordersToPrepare.count).toBe(2);
		expect(data.actions.ordersToPrepare.oldestCreatedAt?.getTime()).toBe(
			oldest.getTime(),
		);
	});

	it("negozio vuoto: zeri e null", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);

		const data = await getSellerDashboard({ storeId: s.id });
		expect(data).toEqual({
			stats: {
				ordersToday: 0,
				revenueToday: "0.00",
				activeProducts: 0,
				activePromotions: 0,
			},
			actions: {
				ordersToPrepare: { count: 0, oldestCreatedAt: null },
				outOfStock: { count: 0, sampleNames: [] },
				lowStock: { count: 0, threshold: 5 },
				expiringPromotions: { count: 0, first: null },
			},
		});
	});
});

describe("getSellerDashboard — prodotti e scorte", () => {
	async function stock(storeId: string, sellerProfileId: string) {
		const db = getTestDb();
		const add = async (
			name: string,
			qty: number,
			status: "active" | "disabled" | "trashed" = "active",
		) => {
			const p = await createTestProduct(db, sellerProfileId, { name, status });
			await createTestStoreProduct(db, storeId, p.id, { stock: qty });
			return p;
		};
		await add("Zucchero", 0);
		await add("Aceto", 0);
		await add("Miele", 0);
		await add("Farina", 2);
		await add("Olio", 4);
		await add("Pasta", 5);
		await add("Riso", 50);
		await add("Spento", 0, "disabled");
		await add("Cestinato", 1, "trashed");
	}

	it("attivi, esauriti con due nomi in ordine alfabetico, scorta bassa sotto la soglia", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		await stock(s.id, seller.profile.id);

		const data = await getSellerDashboard({ storeId: s.id });
		expect(data.stats.activeProducts).toBe(7);
		expect(data.actions.outOfStock).toEqual({
			count: 3,
			sampleNames: ["Aceto", "Miele"],
		});
		// Soglia di default 5: 2 e 4 sì, 5 no (esclusa), 0 no (è esaurito).
		expect(data.actions.lowStock).toEqual({ count: 2, threshold: 5 });
	});

	it("la soglia è del negozio: stessi stock, soglie diverse", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const a = await createTestStore(db, seller.profile.id);
		const b = await createTestStore(db, seller.profile.id);
		const c = await createTestStore(db, seller.profile.id);
		await stock(a.id, seller.profile.id);
		await stock(b.id, seller.profile.id);
		await stock(c.id, seller.profile.id);
		await db
			.update(storeTable)
			.set({ lowStockThreshold: 10 })
			.where(eq(storeTable.id, b.id));
		await db
			.update(storeTable)
			.set({ lowStockThreshold: 0 })
			.where(eq(storeTable.id, c.id));

		const [da, dbb, dc] = await Promise.all([
			getSellerDashboard({ storeId: a.id }),
			getSellerDashboard({ storeId: b.id }),
			getSellerDashboard({ storeId: c.id }),
		]);
		expect(da.actions.lowStock).toEqual({ count: 2, threshold: 5 });
		expect(dbb.actions.lowStock).toEqual({ count: 3, threshold: 10 });
		// 0 spegne l'avviso.
		expect(dc.actions.lowStock).toEqual({ count: 0, threshold: 0 });
	});

	it("la soglia non può essere negativa (CHECK)", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		await expect(
			db
				.update(storeTable)
				.set({ lowStockThreshold: -1 })
				.where(eq(storeTable.id, s.id))
				.execute(),
		).rejects.toThrow();
	});
});

describe("getSellerDashboard — promozioni", () => {
	it("in corso e in scadenza entro 3 giorni, solo del venditore", async () => {
		const db = getTestDb();
		const seller = await createTestSeller(db);
		const stranger = await createTestSeller(db);
		const s = await createTestStore(db, seller.profile.id);
		const now = new Date();
		const t = (ms: number) => new Date(now.getTime() + ms);

		// In corso, senza fine.
		await createTestDiscount(db, seller.profile.id, {
			title: "Sempre",
			startsAt: t(-DAY),
			endsAt: null,
		});
		// In corso, finisce tra 10 giorni.
		await createTestDiscount(db, seller.profile.id, {
			title: "Lunga",
			startsAt: t(-DAY),
			endsAt: t(10 * DAY),
		});
		// In corso, finisce tra 2 giorni e tra 5 ore: in scadenza.
		await createTestDiscount(db, seller.profile.id, {
			title: "Due giorni",
			startsAt: t(-DAY),
			endsAt: t(2 * DAY),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Cinque ore",
			startsAt: t(-DAY),
			endsAt: t(5 * HOUR),
		});
		// Non in corso: programmata, finita, in pausa, archiviata.
		await createTestDiscount(db, seller.profile.id, {
			title: "Programmata",
			startsAt: t(DAY),
			endsAt: t(2 * DAY),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Finita",
			startsAt: t(-3 * DAY),
			endsAt: t(-HOUR),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Pausa",
			status: "paused",
			startsAt: t(-DAY),
			endsAt: t(HOUR),
		});
		await createTestDiscount(db, seller.profile.id, {
			title: "Archivio",
			status: "archived",
			startsAt: t(-DAY),
			endsAt: t(HOUR),
		});
		// Di un altro venditore.
		await createTestDiscount(db, stranger.profile.id, {
			title: "Altrui",
			startsAt: t(-DAY),
			endsAt: t(HOUR),
		});

		const data = await getSellerDashboard({ storeId: s.id, now });
		expect(data.stats.activePromotions).toBe(4);
		expect(data.actions.expiringPromotions.count).toBe(2);
		expect(data.actions.expiringPromotions.first?.name).toBe("Cinque ore");
		expect(data.actions.expiringPromotions.first?.endsAt.getTime()).toBe(
			t(5 * HOUR).getTime(),
		);
	});
});

describe("GET /dashboard", () => {
	async function seedAccess() {
		const db = getTestDb();
		const owner = await createTestSeller(db);
		const assigned = await createTestStore(db, owner.profile.id);
		const other = await createTestStore(db, owner.profile.id);
		const stranger = await createTestSeller(db);

		const { userId: empUserId } = await createTestEmployee(
			db,
			owner.profile.id,
			{ storeIds: [assigned.id] },
		);

		return { owner, stranger, empUserId, assigned, other };
	}

	it("owner → 200 con la forma dello schema", async () => {
		const { owner, other } = await seedAccess();
		const res = await get(owner.user.id, `/dashboard?storeId=${other.id}`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.stats.revenueToday).toBe("0.00");
		expect(body.data.actions.lowStock.threshold).toBe(5);
	});

	it("dipendente sul negozio assegnato → 200", async () => {
		const { empUserId, assigned } = await seedAccess();
		const res = await get(empUserId, `/dashboard?storeId=${assigned.id}`);
		expect(res.status).toBe(200);
	});

	it("dipendente su un negozio non assegnato → 403", async () => {
		const { empUserId, other } = await seedAccess();
		const res = await get(empUserId, `/dashboard?storeId=${other.id}`);
		expect(res.status).toBe(403);
	});

	it("negozio di un altro venditore → 404", async () => {
		const { stranger, assigned } = await seedAccess();
		const res = await get(
			stranger.user.id,
			`/dashboard?storeId=${assigned.id}`,
		);
		expect(res.status).toBe(404);
	});

	it("storeId mancante → errore di validazione", async () => {
		const { owner } = await seedAccess();
		const res = await get(owner.user.id, "/dashboard");
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});
});
