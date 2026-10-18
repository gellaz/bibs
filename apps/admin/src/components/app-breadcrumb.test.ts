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
		expect(
			buildCrumbs("/sellers/00000000-0000-4000-8000-000000000000"),
		).toEqual([
			{ label: "Venditori", href: "/sellers" },
			{
				label: "Dettaglio",
				href: "/sellers/00000000-0000-4000-8000-000000000000",
			},
		]);
		expect(buildCrumbs("/billing/subscriptions").map((c) => c.label)).toEqual([
			"Billing",
			"Abbonamenti",
		]);
	});

	it("etichetta ogni route dell'admin", () => {
		overwriteGetLocale(() => "it");
		expect(
			[
				"users",
				"sellers",
				"stores",
				"products",
				"collections",
				"billing",
				"pricing",
				"subscriptions",
				"profile",
				"configurations",
			].map((s) => labelFor(s)),
		).toEqual([
			"Utenti",
			"Venditori",
			"Negozi",
			"Articoli",
			"Incassi",
			"Billing",
			"Pricing",
			"Abbonamenti",
			"Profilo",
			"Configurazioni",
		]);
	});

	it("una voce delle configurazioni prende il titolo, non lo slug", () => {
		overwriteGetLocale(() => "it");
		expect(
			buildCrumbs("/configurations/product-categories").map((c) => c.label),
		).toEqual(["Configurazioni", "Categorie Prodotto"]);
		// Fuori da /configurations lo slug non è una voce.
		expect(labelFor("holidays")).toBe("holidays");
	});

	it("un segmento senza etichetta resta com'è", () => {
		overwriteGetLocale(() => "it");
		expect(labelFor("sconosciuto")).toBe("sconosciuto");
		expect(labelFor("sconosciuto", "configurations")).toBe("sconosciuto");
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(buildCrumbs("/configurations/holidays").map((c) => c.label)).toEqual(
			["Settings", "Holidays"],
		);
		expect(labelFor("00000000-0000-4000-8000-000000000000")).toBe("Details");
		expect(labelFor("profile")).toBe("Profile");
	});
});
