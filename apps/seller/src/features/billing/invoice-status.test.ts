import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { invoiceStatusBadge, invoiceStatusLabel } from "./invoice-status";

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

describe("invoiceStatusBadge", () => {
	it("dà a ogni fattura il tono per chi la paga", () => {
		const tones = ["open", "paid", "draft", "void", "uncollectible"].map(
			(s) => invoiceStatusBadge(s).tone,
		);
		expect(tones).toEqual([
			"action",
			"success",
			"waiting",
			"closed",
			"destructive",
		]);
	});

	it("senza stato mostra il trattino, chiuso", () => {
		const { label, tone } = invoiceStatusBadge(null);
		expect({ label, tone }).toEqual({ label: "—", tone: "closed" });
	});
});
