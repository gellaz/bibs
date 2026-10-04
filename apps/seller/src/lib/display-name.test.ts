import { displayName } from "@bibs/ui/lib/display-name";
import { describe, expect, test } from "vitest";

describe("displayName", () => {
	test("usa il nome quando è un nome vero", () => {
		expect(
			displayName({ name: "Mario Rossi", email: "mario.rossi@test.com" }),
		).toBe("Mario Rossi");
	});

	test("il local-part dell'email messo alla registrazione cade sull'email", () => {
		expect(
			displayName({ name: "mario.rossi", email: "mario.rossi@test.com" }),
		).toBe("mario.rossi@test.com");
	});

	test("nome vuoto o assente cade sull'email", () => {
		for (const name of ["", "   ", null, undefined]) {
			expect(displayName({ name, email: "a@test.com" })).toBe("a@test.com");
		}
	});

	test("toglie gli spazi ai bordi del nome", () => {
		expect(displayName({ name: "  Anna Bianchi ", email: "a@test.com" })).toBe(
			"Anna Bianchi",
		);
	});
});
