import { afterEach, describe, expect, it } from "vitest";
import { authErrorMessage } from "@/lib/auth-error";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";

const originalGetLocale = getLocale;

afterEach(() => overwriteGetLocale(originalGetLocale));

describe("authErrorMessage", () => {
	it("maps wrong credentials from the code, not from the English message", () => {
		expect(
			authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }, "x"),
		).toBe("Credenziali non valide");
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

	it("follows the current locale", () => {
		overwriteGetLocale(() => "en");
		expect(
			authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }, "x"),
		).toBe("Invalid credentials");
		expect(authErrorMessage({ status: 429 }, "x")).toBe(
			"Too many attempts. Try again in a few minutes.",
		);
	});
});
