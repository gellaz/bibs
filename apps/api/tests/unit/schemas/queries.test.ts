import { describe, expect, it } from "bun:test";
import { ProductSearchQuery } from "@/schemas/queries";

/** Il valore (già decodificato da `v()`) passa lo schema della query. */
const passes = (schema: typeof ProductSearchQuery, value: unknown) =>
	schema.safeParse(value).success;

describe("ProductSearchQuery — geo coordinate bounds", () => {
	it("accepts in-range latitude/longitude", () => {
		expect(passes(ProductSearchQuery, { lat: 41.9028, lng: 12.4964 })).toBe(
			true,
		);
	});

	it("rejects latitude above 90", () => {
		expect(passes(ProductSearchQuery, { lat: 91, lng: 12.5 })).toBe(false);
	});

	it("rejects latitude below -90", () => {
		expect(passes(ProductSearchQuery, { lat: -91 })).toBe(false);
	});

	it("rejects longitude outside [-180, 180]", () => {
		expect(passes(ProductSearchQuery, { lng: 181 })).toBe(false);
		expect(passes(ProductSearchQuery, { lng: -181 })).toBe(false);
	});

	it("still allows the query with no coordinates at all", () => {
		expect(passes(ProductSearchQuery, { q: "pane" })).toBe(true);
	});
});
