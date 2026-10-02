import { describe, expect, it } from "vitest";
import { authErrorMessage } from "@/lib/auth-error";

describe("authErrorMessage", () => {
	it("maps known better-auth codes to Italian copy", () => {
		expect(
			authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }, "x"),
		).toBe("Credenziali non valide");
		expect(authErrorMessage({ code: "INVALID_TOKEN" }, "x")).toBe(
			"Link non valido o scaduto.",
		);
	});

	it("maps rate limiting by status", () => {
		expect(authErrorMessage({ status: 429 }, "x")).toBe(
			"Troppi tentativi. Riprova tra qualche minuto.",
		);
	});

	it("falls back for unknown codes instead of the server message", () => {
		expect(authErrorMessage({ code: "SOMETHING_NEW", status: 400 }, "fb")).toBe(
			"fb",
		);
	});
});
