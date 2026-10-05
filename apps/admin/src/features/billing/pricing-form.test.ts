import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { parsePricingForm } from "./pricing-form";

const originalGetLocale = getLocale;

afterEach(() => overwriteGetLocale(originalGetLocale));

const VALID = { fee: "29,00", days: "60", hours: "24", productId: "prod_ABC1" };

describe("parsePricingForm", () => {
	it("converte i valori validi (virgola decimale compresa)", () => {
		expect(parsePricingForm(VALID)).toEqual({
			value: {
				storeMonthlyFeeCents: 2900,
				suspendedAutoCancelDays: 60,
				pendingCreationExpiryHours: 24,
				productId: "prod_ABC1",
			},
		});
	});

	it("un messaggio per ogni campo fuori dai limiti, in italiano", () => {
		expect(
			parsePricingForm({ fee: "0.5", days: "3", hours: "", productId: "abc" }),
		).toEqual({
			errors: {
				fee: "Inserisci una quota di almeno 1,00 €, con al massimo due decimali",
				days: "Un numero intero di giorni tra 7 e 365",
				hours: "Un numero intero di ore tra 1 e 168",
				productId: "L'ID prodotto Stripe inizia con prod_",
			},
		});
	});

	it("rifiuta più di due decimali e i numeri non interi", () => {
		const r = parsePricingForm({ ...VALID, fee: "29.001", days: "60.5" });
		expect("errors" in r && Object.keys(r.errors)).toEqual(["fee", "days"]);
	});

	it("legge i messaggi nella lingua corrente", () => {
		overwriteGetLocale(() => "en");
		expect(parsePricingForm({ ...VALID, hours: "500" })).toEqual({
			errors: { hours: "A whole number of hours between 1 and 168" },
		});
	});
});
