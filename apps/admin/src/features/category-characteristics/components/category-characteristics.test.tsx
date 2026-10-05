// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { CategoryCharacteristicsButton } from "./category-characteristics-button";
import { removeDescription, valuesOn } from "./category-characteristics-panel";

const originalGetLocale = getLocale;

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
});

const category = (characteristicCount: number) => ({
	id: "c1",
	name: "Abbigliamento donna",
	characteristicCount,
	macroCategory: { name: "Moda" },
});

describe("CategoryCharacteristicsButton", () => {
	it("conteggio singolare e plurale, con l'azione nell'etichetta accessibile", () => {
		overwriteGetLocale(() => "it");
		render(<CategoryCharacteristicsButton category={category(1)} />);
		const button = screen.getByRole("button", {
			name: "Gestisci le caratteristiche di Abbigliamento donna",
		});
		expect(button.textContent).toBe("1 caratteristica");
		cleanup();
		render(<CategoryCharacteristicsButton category={category(10)} />);
		expect(screen.getByRole("button").textContent).toBe("10 caratteristiche");
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		render(<CategoryCharacteristicsButton category={category(1)} />);
		const button = screen.getByRole("button", {
			name: "Manage the characteristics of Abbigliamento donna",
		});
		expect(button.textContent).toBe("1 characteristic");
	});
});

describe("testi del pannello matrice", () => {
	it("valori su N prodotti, singolare e plurale", () => {
		overwriteGetLocale(() => "it");
		expect(valuesOn(1)).toBe("valori su 1 prodotto");
		expect(valuesOn(7)).toBe("valori su 7 prodotti");
		expect(removeDescription(1)).toBe(
			"Questa caratteristica ha valori su 1 prodotto di questa sotto-categoria: verranno eliminati definitivamente.",
		);
	});

	it("follow the current language", () => {
		overwriteGetLocale(() => "en");
		expect(valuesOn(1)).toBe("values on 1 product");
		expect(removeDescription(3)).toBe(
			"This characteristic has values on 3 products in this subcategory: they will be permanently deleted.",
		);
	});
});
