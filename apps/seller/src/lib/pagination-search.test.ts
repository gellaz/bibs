import { describe, expect, test } from "bun:test";
import {
	clampPage,
	parsePaginationSearch,
} from "@bibs/ui/lib/pagination-search";

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

describe("clampPage", () => {
	test("dentro l'intervallo resta invariata", () => {
		expect(clampPage(3, 5)).toBe(3);
	});

	test("oltre l'ultima pagina torna all'ultima (righe cancellate, filtro più stretto)", () => {
		expect(clampPage(7, 5)).toBe(5);
	});

	test("sotto 1 torna a 1", () => {
		expect(clampPage(0, 5)).toBe(1);
		expect(clampPage(-3, 5)).toBe(1);
	});

	test("senza pagine (lista vuota o totale non ancora noto) resta 1", () => {
		expect(clampPage(4, 0)).toBe(1);
	});
});
