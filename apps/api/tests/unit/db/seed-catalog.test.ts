import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	ALCOHOLIC_SUBS,
	brandPoolByMacro,
	type CatalogEntry,
	catalogByPrefix,
	catalogEntryByName,
	descriptionsByGroup,
	descriptionsFor,
	HOUSE_MADE_PREFIXES,
} from "@/db/seed/fixtures/catalog";
import { bolognaPrefixes, businessPrefixes } from "@/db/seed/fixtures/utils";
import { parseCsv } from "@/lib/csv";

const readData = (file: string) =>
	parseCsv(
		readFileSync(
			resolve(import.meta.dir, "../../../src/db/seed/data", file),
			"utf8",
		),
	).rows;
const csvPairs = new Set(
	readData("product_categories.csv").map(([macro, sub]) => `${macro}|${sub}`),
);
const matrix = new Set(
	readData("product_category_characteristics.csv").map(
		([macro, sub, characteristic]) => `${macro}|${sub}|${characteristic}`,
	),
);
const prefixes = [...businessPrefixes, ...bolognaPrefixes];
const allEntries = Object.values(catalogByPrefix).flat();

// La tabella della spec (C6): cosa può vendere ciascun tipo alimentare.
const RISTORAZIONE = [
	"Piatti pronti",
	"Vino",
	"Pasta",
	"Dolci",
	"Conserve",
	"Olio e condimenti",
];
const ALLOWED_SUBS: Record<string, readonly string[]> = {
	Macelleria: ["Carne", "Salumi", "Piatti pronti"],
	Pescheria: ["Pesce", "Piatti pronti", "Conserve"],
	Enoteca: ["Vino", "Birra", "Liquori e distillati", "Olio e condimenti"],
	Gelateria: ["Gelati", "Dolci"],
	Panificio: ["Pane e prodotti da forno", "Dolci"],
	Ristorante: RISTORAZIONE,
	Trattoria: RISTORAZIONE,
	Osteria: RISTORAZIONE,
	Pizzeria: RISTORAZIONE,
};

describe("catalogo del seed per tipo di negozio", () => {
	it("copre i 41 tipi con 20–30 voci dai nomi unici", () => {
		expect(Object.keys(catalogByPrefix).sort()).toEqual([...prefixes].sort());
		for (const prefix of prefixes) {
			const names = catalogByPrefix[prefix].map((e) => e.name);
			expect(names.length).toBeGreaterThanOrEqual(20);
			expect(names.length).toBeLessThanOrEqual(30);
			expect(new Set(names).size).toBe(names.length);
		}
	});

	it("ogni voce punta a una coppia macro/sotto-categoria del CSV", () => {
		const missing = allEntries
			.filter((e) => !csvPairs.has(`${e.macro}|${e.sub}`))
			.map((e) => `${e.name} → ${e.macro} / ${e.sub}`);
		expect(missing).toEqual([]);
	});

	it("skip nomina solo caratteristiche della sotto-categoria", () => {
		const unknown = allEntries.flatMap((e) =>
			(e.skip ?? [])
				.filter((c) => !matrix.has(`${e.macro}|${e.sub}|${c}`))
				.map((c) => `${e.name}: ${c}`),
		);
		expect(unknown).toEqual([]);
	});

	it("un nome ripetuto tra pool ha ovunque la stessa voce", () => {
		const shape = (e: CatalogEntry) =>
			JSON.stringify([e.macro, e.sub, e.skip ?? [], e.price ?? null]);
		for (const e of allEntries) {
			expect(shape(catalogEntryByName(e.name)!)).toBe(shape(e));
		}
	});

	it("le fasce di prezzo per voce sono 0 < min < max", () => {
		const priced = allEntries.filter((e) => e.price);
		expect(priced.length).toBeGreaterThan(0);
		for (const { price } of priced) {
			const [min, max] = price!;
			expect(min).toBeGreaterThan(0);
			expect(max).toBeGreaterThan(min);
		}
	});

	it("i tipi alimentari restano nelle loro sotto-categorie", () => {
		for (const [prefix, allowed] of Object.entries(ALLOWED_SUBS)) {
			const outside = catalogByPrefix[prefix]
				.filter((e) => !allowed.includes(e.sub))
				.map((e) => `${prefix}: ${e.name} (${e.sub})`);
			expect(outside).toEqual([]);
		}
	});

	it("ogni macro usata ha marchi; marchi unici tra macro", () => {
		const macros = new Set(allEntries.map((e) => e.macro));
		for (const macro of macros) {
			// 8, non 6: un seller monomacro ne riceve fino a 8 distinti dallo stesso pool.
			expect(brandPoolByMacro[macro]?.length ?? 0).toBeGreaterThanOrEqual(8);
		}
		const brands = Object.values(brandPoolByMacro).flat();
		expect(new Set(brands).size).toBe(brands.length);
	});

	it("ogni voce ha almeno 4 descrizioni del suo gruppo", () => {
		for (const e of allEntries) {
			expect(descriptionsFor(e).length).toBeGreaterThanOrEqual(4);
		}
		for (const texts of Object.values(descriptionsByGroup)) {
			expect(texts.length).toBeGreaterThanOrEqual(4);
		}
	});

	it("i tipi che producono da sé sono tipi di negozio veri", () => {
		for (const prefix of HOUSE_MADE_PREFIXES)
			expect(prefixes).toContain(prefix);
	});

	it("gli alcolici sono vino, birra e distillati", () => {
		expect([...ALCOHOLIC_SUBS].sort()).toEqual([
			"Birra",
			"Liquori e distillati",
			"Vino",
		]);
	});

	it("il tagliere salta le caratteristiche elettriche e il legno del nome", () => {
		expect(
			catalogByPrefix.Casalinghi.find(
				(e) => e.name === "Tagliere in legno d'ulivo",
			),
		).toEqual({
			name: "Tagliere in legno d'ulivo",
			macro: "Casa e cucina",
			sub: "Utensili cucina",
			skip: [
				"Potenza",
				"Alimentazione",
				"Tensione batteria",
				"Velocità",
				"Materiale",
				"Colore",
			],
		});
	});
});
