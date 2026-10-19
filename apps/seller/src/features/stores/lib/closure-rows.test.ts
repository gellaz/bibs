import { describe, expect, it } from "vitest";
import {
	closureDays,
	closureRows,
	type HolidayRow,
	serializeClosures,
	splitCustomClosures,
} from "./closure-rows";

const TODAY = "2026-10-19";

const holiday = (
	definitionId: string,
	nextDate: string | null,
): HolidayRow => ({
	definitionId,
	name: definitionId,
	type: "fixed",
	nextDate,
	observed: true,
});

describe("splitCustomClosures", () => {
	it("le finite prima di oggi sono passate; chi finisce oggi o dopo resta", () => {
		const { past, upcoming } = splitCustomClosures(
			[
				{ startDate: "2026-10-10" },
				{ startDate: "2026-10-15", endDate: "2026-10-19" },
				{ startDate: "2026-12-24" },
			],
			TODAY,
		);
		expect(past).toEqual([{ startDate: "2026-10-10" }]);
		expect(upcoming.map((c) => c.startDate)).toEqual([
			"2026-10-15",
			"2026-12-24",
		]);
	});
});

describe("closureRows", () => {
	it("festività e chiusure insieme, in ordine di data, senza data in fondo", () => {
		const rows = closureRows(
			[holiday("natale", "2026-12-25"), holiday("sparita", null)],
			{ optOutIds: [], customClosures: [{ startDate: "2026-11-02" }] },
		);
		expect(rows.map((r) => r.start)).toEqual([
			"2026-11-02",
			"2026-12-25",
			null,
		]);
	});

	it("una festività fra gli opt-out è aperta, le altre chiuse", () => {
		const rows = closureRows(
			[holiday("natale", "2026-12-25"), holiday("stefano", "2026-12-26")],
			{ optOutIds: ["stefano"], customClosures: [] },
		);
		expect(
			rows.map((r) => (r.kind === "holiday" ? r.closed : undefined)),
		).toEqual([true, false]);
	});

	it("la chiusura tua porta l'indice nella bozza e la nota come nome", () => {
		const rows = closureRows([], {
			optOutIds: [],
			customClosures: [
				{ startDate: "2027-08-09", endDate: "2027-08-23", note: " Ferie " },
				{ startDate: "2026-11-02", note: "  " },
			],
		});
		expect(rows).toEqual([
			expect.objectContaining({ kind: "custom", index: 1, name: null }),
			expect.objectContaining({
				kind: "custom",
				index: 0,
				name: "Ferie",
				end: "2027-08-23",
			}),
		]);
	});
});

describe("closureDays", () => {
	it("conta i giorni estremi compresi", () => {
		expect(closureDays("2027-08-09", "2027-08-23")).toBe(15);
		expect(closureDays("2026-11-02")).toBe(1);
		expect(closureDays("2026-12-30", "2027-01-02")).toBe(4);
	});
});

describe("serializeClosures", () => {
	it("non dipende dall'ordine di opt-out e chiusure", () => {
		const a = serializeClosures({
			optOutIds: ["b", "a"],
			customClosures: [
				{ startDate: "2027-01-07" },
				{ startDate: "2026-11-02" },
			],
		});
		const b = serializeClosures({
			optOutIds: ["a", "b"],
			customClosures: [
				{ startDate: "2026-11-02" },
				{ startDate: "2027-01-07" },
			],
		});
		expect(a).toBe(b);
	});
});
