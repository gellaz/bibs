import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { buildCrumbs, labelFor } from "./app-breadcrumb";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

describe("buildCrumbs", () => {
	it("un'etichetta per segmento, con il percorso cumulato", () => {
		overwriteGetLocale(() => "it");
		expect(buildCrumbs("/orders/00000000-0000-4000-8000-000000000000")).toEqual(
			[
				{ label: "Ordini", href: "/orders" },
				{
					label: "Dettaglio",
					href: "/orders/00000000-0000-4000-8000-000000000000",
				},
			],
		);
		expect(buildCrumbs("/store/new").map((c) => c.label)).toEqual([
			"Negozio",
			"Nuovo",
		]);
	});

	it("un segmento senza etichetta resta com'è", () => {
		overwriteGetLocale(() => "it");
		expect(labelFor("closures")).toBe("closures");
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(buildCrumbs("/promotions/new").map((c) => c.label)).toEqual([
			"Promotions",
			"New",
		]);
		expect(labelFor("00000000-0000-4000-8000-000000000000")).toBe("Details");
	});
});
