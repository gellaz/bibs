import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { loginFormSchema } from "./login";
import { registerFormSchema } from "./register";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

function messages(result: {
	success: boolean;
	error?: { issues: { message: string }[] };
}) {
	return result.error?.issues.map((i) => i.message) ?? [];
}

describe("loginFormSchema", () => {
	it("messaggi in italiano", () => {
		overwriteGetLocale(() => "it");
		expect(
			messages(loginFormSchema.safeParse({ email: "", password: "" })),
		).toEqual([
			"L'email è obbligatoria",
			"Email non valida",
			"La password è obbligatoria",
		]);
	});

	it("follows the current language, read at validation time", () => {
		overwriteGetLocale(() => "en");
		expect(
			messages(loginFormSchema.safeParse({ email: "x", password: "p" })),
		).toEqual(["Invalid email"]);
	});
});

describe("registerFormSchema", () => {
	it("password corta e conferma diversa", () => {
		overwriteGetLocale(() => "it");
		expect(
			messages(
				registerFormSchema.safeParse({
					email: "a@b.it",
					password: "corta",
					confirmPassword: "corta",
				}),
			),
		).toEqual(["La password deve avere almeno 8 caratteri"]);
		expect(
			messages(
				registerFormSchema.safeParse({
					email: "a@b.it",
					password: "password123",
					confirmPassword: "password124",
				}),
			),
		).toEqual(["Le password non corrispondono"]);
	});

	it("password oltre i 128 caratteri dell'API", () => {
		overwriteGetLocale(() => "it");
		const long = "a".repeat(129);
		expect(
			messages(
				registerFormSchema.safeParse({
					email: "a@b.it",
					password: long,
					confirmPassword: long,
				}),
			),
		).toEqual(["La password può avere al massimo 128 caratteri"]);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(
			messages(
				registerFormSchema.safeParse({
					email: "a@b.it",
					password: "password123",
					confirmPassword: "",
				}),
			),
		).toEqual(["Confirm your password", "Passwords don't match"]);
	});
});
