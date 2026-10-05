import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { invoiceStatusLabel } from "./invoice-status";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

const STATUSES = ["paid", "open", "void", "uncollectible", "draft"] as const;

describe("invoiceStatusLabel", () => {
	it("etichetta gli stati di Stripe in italiano", () => {
		overwriteGetLocale(() => "it");
		expect(STATUSES.map(invoiceStatusLabel)).toEqual([
			"Pagata",
			"Da pagare",
			"Annullata",
			"Non riscossa",
			"Bozza",
		]);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(STATUSES.map(invoiceStatusLabel)).toEqual([
			"Paid",
			"Open",
			"Void",
			"Uncollectible",
			"Draft",
		]);
	});

	it("uno stato sconosciuto resta grezzo, nessuno stato è «—»", () => {
		overwriteGetLocale(() => "it");
		expect(invoiceStatusLabel("weird_status")).toBe("weird_status");
		expect(invoiceStatusLabel(null)).toBe("—");
	});
});
