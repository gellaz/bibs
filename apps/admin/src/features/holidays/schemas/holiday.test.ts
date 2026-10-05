import { setIntlLocaleResolver } from "@bibs/ui/lib/intl-locale";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { type HolidayFormData, holidayFormSchema, monthNames } from "./holiday";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
	setIntlLocaleResolver(() => "it-IT");
});

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

describe("messaggi dello schema", () => {
	function messages(data: HolidayFormData) {
		const result = holidayFormSchema.safeParse(data);
		return result.success ? [] : result.error.issues.map((i) => i.message);
	}

	it("in italiano", () => {
		overwriteGetLocale(() => "it");
		expect(messages({ type: "fixed", name: "", month: "13" })).toEqual([
			"Il nome è obbligatorio",
			"Mese non valido",
			"Giorno non valido",
		]);
	});

	it("follow the current language", () => {
		overwriteGetLocale(() => "en");
		expect(messages({ type: "one_off", name: "" })).toEqual([
			"Name is required",
			"Date is required",
		]);
		expect(messages({ type: "easter_relative", name: "Easter" })).toEqual([
			"Offset is required",
		]);
	});
});

describe("monthNames", () => {
	it("dodici mesi con l'iniziale maiuscola", () => {
		setIntlLocaleResolver(() => "it-IT");
		const months = monthNames();
		expect(months).toHaveLength(12);
		expect(months[0]).toBe("Gennaio");
		expect(months[11]).toBe("Dicembre");
	});

	it("follows the current language", () => {
		setIntlLocaleResolver(() => "en-GB");
		expect(monthNames()[0]).toBe("January");
		expect(monthNames()[7]).toBe("August");
	});
});
