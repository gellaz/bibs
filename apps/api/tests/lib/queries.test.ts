import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { ProductSearchQuery } from "@/lib/queries";

describe("ProductSearchQuery — geo coordinate bounds", () => {
	it("accepts in-range latitude/longitude", () => {
		expect(
			Value.Check(ProductSearchQuery, { lat: 41.9028, lng: 12.4964 }),
		).toBe(true);
	});

	it("rejects latitude above 90", () => {
		expect(Value.Check(ProductSearchQuery, { lat: 91, lng: 12.5 })).toBe(false);
	});

	it("rejects latitude below -90", () => {
		expect(Value.Check(ProductSearchQuery, { lat: -91 })).toBe(false);
	});

	it("rejects longitude outside [-180, 180]", () => {
		expect(Value.Check(ProductSearchQuery, { lng: 181 })).toBe(false);
		expect(Value.Check(ProductSearchQuery, { lng: -181 })).toBe(false);
	});

	it("still allows the query with no coordinates at all", () => {
		expect(Value.Check(ProductSearchQuery, { q: "pane" })).toBe(true);
	});
});
