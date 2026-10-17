import { describe, expect, it } from "bun:test";
import { skippedCharacteristics } from "@/db/seed/fixtures/characteristic-values";

describe("skippedCharacteristics", () => {
	it("niente caratteristiche da oggetto sugli alimenti", () => {
		const food = skippedCharacteristics(
			"Alimentari e bevande",
			"Pasta",
			"Fusilli senza glutine",
		);
		for (const c of ["Modello", "Colore", "Materiale", "Dimensioni", "Peso"])
			expect(food.has(c)).toBe(true);
	});

	it("una quantità nel nome salta peso e formato", () => {
		const sized = skippedCharacteristics(
			"Alimentari e bevande",
			"Pasta",
			"Spaghetti di grano duro 500 g",
		);
		expect(sized.has("Formato/Peso netto")).toBe(true);
		expect(
			skippedCharacteristics(
				"Alimentari e bevande",
				"Vino",
				"Chianti Classico 75 cl",
			).has("Capacità netta"),
		).toBe(true);
	});

	it("aggiunge lo skip della voce di catalogo", () => {
		expect(
			skippedCharacteristics(
				"Casa e cucina",
				"Utensili cucina",
				"Tagliere in legno d'ulivo",
			).has("Potenza"),
		).toBe(true);
		expect(
			skippedCharacteristics("Elettronica", "Smartphone", "Smartphone 128 GB")
				.size,
		).toBe(0);
	});

	it("salta ciò che il nome della voce dichiara già", () => {
		expect(
			skippedCharacteristics(
				"Abbigliamento",
				"Borse",
				"Borsa a mano in pelle",
			).has("Materiale"),
		).toBe(true);
		expect(
			skippedCharacteristics(
				"Elettronica",
				"Smartphone",
				"Smartphone Android 128 GB",
			).has("Memoria interna"),
		).toBe(true);
		expect(
			skippedCharacteristics(
				"Alimentari e bevande",
				"Vino",
				"Primitivo di Manduria DOC 75 cl",
			).has("Vitigno"),
		).toBe(true);
	});
});
