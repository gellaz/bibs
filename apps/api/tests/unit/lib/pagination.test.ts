import { describe, expect, it } from "bun:test";
import { parsePagination } from "@/lib/pagination";

describe("parsePagination", () => {
	it("returns defaults when no params are provided", () => {
		const result = parsePagination({});
		expect(result.page).toBe(1);
		expect(result.limit).toBe(20);
		expect(result.offset).toBe(0);
	});

	it("uses provided page and limit", () => {
		const result = parsePagination({ page: 3, limit: 10 });
		expect(result.page).toBe(3);
		expect(result.limit).toBe(10);
	});

	it("calculates offset correctly", () => {
		expect(parsePagination({ page: 1, limit: 10 }).offset).toBe(0);
		expect(parsePagination({ page: 2, limit: 10 }).offset).toBe(10);
		expect(parsePagination({ page: 3, limit: 10 }).offset).toBe(20);
		expect(parsePagination({ page: 5, limit: 20 }).offset).toBe(80);
	});

	it("uses default limit when only page is provided", () => {
		const result = parsePagination({ page: 2 });
		expect(result.limit).toBe(20);
		expect(result.offset).toBe(20);
	});

	it("uses default page when only limit is provided", () => {
		const result = parsePagination({ limit: 50 });
		expect(result.page).toBe(1);
		expect(result.offset).toBe(0);
	});
});
