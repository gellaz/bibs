import { describe, expect, it } from "vitest";
import { type HolidayFormData, holidayFormSchema } from "./holiday";

function errorPaths(data: HolidayFormData) {
	const result = holidayFormSchema.safeParse(data);
	return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("holidayFormSchema", () => {
	it("fissa: mese e giorno nei limiti", () => {
		expect(
			errorPaths({ type: "fixed", name: "Natale", month: "12", day: "25" }),
		).toEqual([]);
		expect(
			errorPaths({ type: "fixed", name: "Natale", month: "13", day: "0" }),
		).toEqual(["month", "day"]);
	});

	it("relativa alla Pasqua: l'offset è obbligatorio, 0 compreso", () => {
		expect(
			errorPaths({
				type: "easter_relative",
				name: "Pasqua",
				easterOffsetDays: "0",
			}),
		).toEqual([]);
		expect(errorPaths({ type: "easter_relative", name: "Pasquetta" })).toEqual([
			"easterOffsetDays",
		]);
	});

	it("una tantum: data in formato yyyy-mm-dd", () => {
		expect(
			errorPaths({ type: "one_off", name: "Ponte", oneOffDate: "2026-12-07" }),
		).toEqual([]);
		expect(
			errorPaths({ type: "one_off", name: "Ponte", oneOffDate: "07/12/2026" }),
		).toEqual(["oneOffDate"]);
	});

	it("i campi degli altri tipi non vengono controllati", () => {
		expect(
			errorPaths({
				type: "one_off",
				name: "Ponte",
				oneOffDate: "2026-12-07",
				month: "99",
			}),
		).toEqual([]);
	});

	it("il nome è obbligatorio", () => {
		expect(
			errorPaths({ type: "fixed", name: "", month: "1", day: "1" }),
		).toEqual(["name"]);
	});
});
