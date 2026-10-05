import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import {
	type ProductCharacteristicFormData,
	productCharacteristicFormSchema,
} from "./product-characteristic";

function parse(overrides: Partial<ProductCharacteristicFormData>) {
	return productCharacteristicFormSchema.safeParse({
		name: "Colore",
		dataType: "enum",
		unit: "",
		options: [{ value: "Rosso" }],
		...overrides,
	});
}

function messages(result: ReturnType<typeof parse>) {
	return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("productCharacteristicFormSchema", () => {
	it("accetta una lista chiusa con opzioni distinte", () => {
		expect(
			parse({ options: [{ value: "Rosso" }, { value: "Blu" }] }).success,
		).toBe(true);
	});

	it("una lista chiusa senza opzioni non vuote è rifiutata", () => {
		expect(messages(parse({ options: [{ value: "  " }] }))).toContain(
			"Una lista chiusa richiede almeno un'opzione",
		);
	});

	it("le opzioni ripetute sono rifiutate (dopo il trim)", () => {
		expect(
			messages(parse({ options: [{ value: "Rosso" }, { value: " Rosso " }] })),
		).toContain('Opzione ripetuta: "Rosso"');
	});

	it("l'unità oltre 20 caratteri blocca solo un tipo numero", () => {
		const unit = "x".repeat(21);
		expect(
			messages(parse({ dataType: "number", unit, options: [] })),
		).toContain("L'unità di misura non può superare 20 caratteri");
		// Nascosta per gli altri tipi: non deve bloccare il salvataggio.
		expect(parse({ dataType: "text", unit, options: [] }).success).toBe(true);
	});

	it("le opzioni non contano per un tipo diverso da enum", () => {
		expect(parse({ dataType: "boolean", options: [] }).success).toBe(true);
	});
});

describe("productCharacteristicFormSchema in English", () => {
	const originalGetLocale = getLocale;
	afterEach(() => overwriteGetLocale(originalGetLocale));

	it("reads its messages at validation time", () => {
		overwriteGetLocale(() => "en");
		expect(messages(parse({ name: " " }))).toContain("Name is required");
		expect(messages(parse({ options: [] }))).toContain(
			"A fixed list needs at least one option",
		);
		expect(
			messages(parse({ options: [{ value: "Red" }, { value: "Red" }] })),
		).toContain('Duplicate option: "Red"');
	});
});
