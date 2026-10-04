import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { discountFormSchema } from "./discount-form";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

const endBeforeStart = {
	title: "Saldi",
	percent: 10,
	startsAt: "2026-10-10T09:00",
	endsAt: "2026-10-05T09:00",
	noEndDate: false,
};

function endsAtMessage() {
	const result = discountFormSchema.safeParse(endBeforeStart);
	if (result.success) throw new Error("expected a validation error");
	return result.error.issues.find((i) => i.path[0] === "endsAt")?.message;
}

describe("discountFormSchema", () => {
	// Lo schema vive a livello di modulo: il messaggio va letto alla
	// validazione, non all'import, o resterebbe nella lingua del primo caricamento.
	it("reads the end-date message in the language active at validation time", () => {
		overwriteGetLocale(() => "it");
		expect(endsAtMessage()).toBe(
			"La data di fine deve essere successiva all'inizio",
		);
		overwriteGetLocale(() => "en");
		expect(endsAtMessage()).toBe("The end date must be after the start");
	});
});
