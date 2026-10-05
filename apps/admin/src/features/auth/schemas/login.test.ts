import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { loginFormSchema } from "./login";

const originalGetLocale = getLocale;

afterEach(() => overwriteGetLocale(originalGetLocale));

function messages(data: { email: string; password: string }) {
	const result = loginFormSchema.safeParse(data);
	return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("loginFormSchema", () => {
	it("accetta email e password compilate", () => {
		expect(messages({ email: "a@b.it", password: "x" })).toEqual([]);
	});

	it("campi vuoti e email non valida, in italiano", () => {
		expect(messages({ email: "", password: "" })).toEqual([
			"L'email è obbligatoria",
			"Email non valida",
			"La password è obbligatoria",
		]);
		expect(messages({ email: "a@b", password: "x" })).toEqual([
			"Email non valida",
		]);
	});

	it("legge i messaggi alla validazione, nella lingua corrente", () => {
		overwriteGetLocale(() => "en");
		expect(messages({ email: "", password: "" })).toEqual([
			"Email is required",
			"Invalid email",
			"Password is required",
		]);
	});
});
