import { describe, expect, it } from "vitest";
import { productsPhrase } from "./data-type";

describe("productsPhrase", () => {
	it("singolare solo per 1", () => {
		expect(productsPhrase(1)).toBe("1 prodotto");
	});

	it("plurale per 0 e per più di 1", () => {
		expect(productsPhrase(0)).toBe("0 prodotti");
		expect(productsPhrase(12)).toBe("12 prodotti");
	});
});
