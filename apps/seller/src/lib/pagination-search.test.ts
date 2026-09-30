import { describe, expect, test } from "bun:test";
import { parsePaginationSearch } from "@bibs/ui/lib/pagination-search";

describe("parsePaginationSearch", () => {
	test("default senza parametri", () => {
		expect(parsePaginationSearch({})).toEqual({ page: 1, limit: 20 });
	});

	test("accetta interi positivi, anche come stringa", () => {
		expect(parsePaginationSearch({ page: "3", limit: 50 })).toEqual({
			page: 3,
			limit: 50,
		});
	});

	test("valori non validi tornano ai default", () => {
		for (const bad of ["abc", 0, -2, 1.5, "", null, [], {}]) {
			expect(parsePaginationSearch({ page: bad, limit: bad })).toEqual({
				page: 1,
				limit: 20,
			});
		}
	});

	test("limit oltre il cap dell'API viene limitato a 100", () => {
		expect(parsePaginationSearch({ limit: "1000000" }).limit).toBe(100);
	});
});
