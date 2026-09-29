import { describe, expect, it } from "bun:test";
import { containsPattern, escapeLike, prefixPattern } from "@/lib/like";

describe("escapeLike", () => {
	it("escapes the LIKE wildcards and the escape character", () => {
		expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
	});

	it("leaves plain text untouched", () => {
		expect(escapeLike("Forno Rossi")).toBe("Forno Rossi");
	});
});

describe("containsPattern / prefixPattern", () => {
	it("wraps the escaped text", () => {
		expect(containsPattern("a_b")).toBe("%a\\_b%");
		expect(prefixPattern("a%")).toBe("a\\%%");
	});
});
