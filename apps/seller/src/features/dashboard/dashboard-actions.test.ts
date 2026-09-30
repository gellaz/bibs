import { describe, expect, it } from "bun:test";
import {
	buildDashboardActions,
	type DashboardActionsData,
	formatRelative,
	formatTodayLabel,
	hoursAction,
	sortByUrgency,
} from "./dashboard-actions";

const NOW = new Date("2026-09-28T10:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const EMPTY: DashboardActionsData = {
	ordersToPrepare: { count: 0, oldestCreatedAt: null },
	outOfStock: { count: 0, sampleNames: [] },
	lowStock: { count: 0, threshold: 5 },
	expiringPromotions: { count: 0, first: null },
};

describe("sortByUrgency", () => {
	it("high → medium → low, stabile a parità di urgenza", () => {
		const sorted = sortByUrgency([
			{ id: "a", urgency: "low" as const },
			{ id: "b", urgency: "medium" as const },
			{ id: "c", urgency: "high" as const },
			{ id: "d", urgency: "medium" as const },
			{ id: "e", urgency: "high" as const },
		]);
		expect(sorted.map((x) => x.id)).toEqual(["c", "e", "b", "d", "a"]);
	});

	it("non muta l'array in ingresso", () => {
		const input = [
			{ id: "a", urgency: "low" as const },
			{ id: "b", urgency: "high" as const },
		];
		sortByUrgency(input);
		expect(input.map((x) => x.id)).toEqual(["a", "b"]);
	});
});

describe("hoursAction", () => {
	it("nessuno stato → nessun avviso", () => {
		expect(hoursAction(null)).toBeNull();
		expect(hoursAction(undefined)).toBeNull();
	});

	it("aperto → nessun avviso (niente «Aperto adesso» generico)", () => {
		expect(hoursAction({ isOpen: true, status: "open" })).toBeNull();
	});

	it("orari mai impostati → medium, verso /store", () => {
		const a = hoursAction({ isOpen: false, status: "unknown" });
		expect(a?.id).toBe("hours-missing");
		expect(a?.urgency).toBe("medium");
		expect(a?.href).toBe("/store");
		expect(a?.title).toBe("Orari non ancora impostati");
	});

	it("festività → medium, verso le chiusure", () => {
		const a = hoursAction({ isOpen: false, status: "closed_holiday" });
		expect(a?.urgency).toBe("medium");
		expect(a?.href).toBe("/store/closures");
		expect(a?.title).toBe("Oggi il negozio è chiuso");
	});

	it("dipendente → scheda negozio, le chiusure sono del titolare", () => {
		for (const status of ["closed_holiday", "closed"] as const) {
			expect(hoursAction({ isOpen: false, status }, false)?.href).toBe(
				"/store",
			);
		}
	});

	it("chiuso adesso → low, con la riapertura (anche se Eden ha idratato una Date)", () => {
		const a = hoursAction({
			isOpen: false,
			status: "closed",
			opensAt: { date: new Date("2026-09-29T00:00:00Z"), time: "09:00" },
		});
		expect(a?.urgency).toBe("low");
		expect(a?.subtitle).toBe("Riapre il 2026-09-29 alle 09:00");
	});

	it("chiuso senza riapertura in vista", () => {
		const a = hoursAction({ isOpen: false, status: "closed" });
		expect(a?.subtitle).toBe("Nessuna riapertura nei prossimi 60 giorni");
	});
});

describe("formatRelative", () => {
	it("passato in minuti, mai sotto 1", () => {
		expect(formatRelative(new Date(NOW.getTime() - 38 * MIN), NOW)).toBe(
			"38 minuti fa",
		);
		expect(formatRelative(new Date(NOW.getTime() - 5_000), NOW)).toBe(
			"1 minuto fa",
		);
	});

	it("futuro in ore sotto il giorno, poi in giorni", () => {
		expect(formatRelative(new Date(NOW.getTime() + 5 * HOUR), NOW)).toBe(
			"tra 5 ore",
		);
		expect(formatRelative(new Date(NOW.getTime() + 2 * DAY), NOW)).toBe(
			"tra 2 giorni",
		);
	});
});

describe("formatTodayLabel", () => {
	it("giorno di calendario a Roma, iniziale maiuscola", () => {
		// 22:30Z del 15 luglio = 00:30 del 16 a Roma.
		expect(formatTodayLabel(new Date("2026-07-15T22:30:00Z"))).toBe(
			"Giovedì 16 luglio",
		);
	});
});

describe("buildDashboardActions", () => {
	it("tutto a zero, posizione presente, negozio aperto → nessuna voce", () => {
		expect(
			buildDashboardActions({
				dashboard: EMPTY,
				locationMissing: false,
				openStatus: { isOpen: true, status: "open" },
				now: NOW,
			}),
		).toEqual([]);
	});

	it("una voce compare solo se il conteggio è > 0", () => {
		const ids = buildDashboardActions({
			dashboard: { ...EMPTY, lowStock: { count: 3, threshold: 8 } },
			locationMissing: false,
			openStatus: null,
			now: NOW,
		}).map((a) => a.id);
		expect(ids).toEqual(["low-stock"]);
	});

	it("ordina per urgenza: le high prima, gli orari chiusi in fondo", () => {
		const actions = buildDashboardActions({
			dashboard: {
				ordersToPrepare: {
					count: 3,
					oldestCreatedAt: new Date(NOW.getTime() - 38 * MIN),
				},
				outOfStock: { count: 2, sampleNames: ["Riso", "Tisana"] },
				lowStock: { count: 5, threshold: 5 },
				expiringPromotions: {
					count: 1,
					first: {
						name: "Sconto estate",
						endsAt: new Date(NOW.getTime() + 2 * DAY),
					},
				},
			},
			locationMissing: true,
			openStatus: { isOpen: false, status: "closed" },
			now: NOW,
		});
		expect(actions.map((a) => [a.id, a.urgency])).toEqual([
			["location-missing", "high"],
			["orders-to-prepare", "high"],
			["out-of-stock", "high"],
			["low-stock", "medium"],
			["promo-expiring", "medium"],
			["hours-status", "low"],
		]);
		const byId = Object.fromEntries(actions.map((a) => [a.id, a]));
		expect(byId["orders-to-prepare"].title).toBe("3 ordini da preparare");
		expect(byId["orders-to-prepare"].subtitle).toBe(
			"Il più vecchio è arrivato 38 minuti fa",
		);
		expect(byId["orders-to-prepare"].href).toBe("/orders");
		expect(byId["out-of-stock"].subtitle).toBe("Riso · Tisana");
		expect(byId["out-of-stock"].href).toBe("/products");
		expect(byId["low-stock"].subtitle).toBe("Sotto le 5 unità");
		expect(byId["promo-expiring"].title).toBe(
			"Promo «Sconto estate» scade tra 2 giorni",
		);
		expect(byId["promo-expiring"].href).toBe("/promotions");
	});

	it("orari mai impostati (medium) passano davanti a nulla di high", () => {
		const actions = buildDashboardActions({
			dashboard: {
				...EMPTY,
				ordersToPrepare: { count: 1, oldestCreatedAt: NOW },
			},
			locationMissing: false,
			openStatus: { isOpen: false, status: "unknown" },
			now: NOW,
		});
		expect(actions.map((a) => a.id)).toEqual([
			"orders-to-prepare",
			"hours-missing",
		]);
		expect(actions[0].title).toBe("1 ordine da preparare");
	});

	it("singolare/plurale ed eccedenza dei nomi esauriti", () => {
		const [one] = buildDashboardActions({
			dashboard: {
				...EMPTY,
				outOfStock: { count: 1, sampleNames: ["Riso"] },
			},
			locationMissing: false,
			openStatus: null,
			now: NOW,
		});
		expect(one.title).toBe("1 prodotto esaurito");
		expect(one.subtitle).toBe("Riso");

		const [many] = buildDashboardActions({
			dashboard: {
				...EMPTY,
				outOfStock: { count: 5, sampleNames: ["Aceto", "Miele"] },
			},
			locationMissing: false,
			openStatus: null,
			now: NOW,
		});
		expect(many.title).toBe("5 prodotti esauriti");
		expect(many.subtitle).toBe("Aceto · Miele e altri 3");
	});

	it("più promo in scadenza: titolo al plurale, la prima nel sottotitolo", () => {
		const [a] = buildDashboardActions({
			dashboard: {
				...EMPTY,
				expiringPromotions: {
					count: 2,
					first: { name: "Flash", endsAt: new Date(NOW.getTime() + 5 * HOUR) },
				},
			},
			locationMissing: false,
			openStatus: null,
			now: NOW,
		});
		expect(a.title).toBe("2 promozioni in scadenza");
		expect(a.subtitle).toBe("La prima, «Flash», scade tra 5 ore");
	});

	it("riepilogo non ancora arrivato: restano gli avvisi di posizione e orari", () => {
		const ids = buildDashboardActions({
			dashboard: null,
			locationMissing: true,
			openStatus: { isOpen: false, status: "unknown" },
			now: NOW,
		}).map((a) => a.id);
		expect(ids).toEqual(["location-missing", "hours-missing"]);
	});
});
