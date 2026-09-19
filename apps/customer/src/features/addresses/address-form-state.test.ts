import { describe, expect, it } from "bun:test";
import {
	addressFormToBody,
	addressToAddressForm,
	emptyAddressForm,
	isAddressFormValid,
	suggestionToAddressForm,
	validateAddressForm,
} from "./address-form-state";

const MILANO = { id: "m-mi", name: "Milano", provinceAcronym: "MI" };

const SUGGESTION = {
	addressLine1: "Via Roma 12",
	zipCode: "20096",
	location: { x: 9.327, y: 45.499 },
	municipality: MILANO,
	municipalityCandidates: [],
};

describe("emptyAddressForm", () => {
	it("starts with no municipality and no position", () => {
		const form = emptyAddressForm();
		expect(form.municipalityId).toBeNull();
		expect(form.location).toBeNull();
		expect(form.isDefault).toBe(false);
	});
});

describe("suggestionToAddressForm", () => {
	it("fills address, zip, municipality and position in one go", () => {
		const form = suggestionToAddressForm(SUGGESTION, emptyAddressForm());

		expect(form.addressLine1).toBe("Via Roma 12");
		expect(form.zipCode).toBe("20096");
		expect(form.municipalityId).toBe("m-mi");
		expect(form.location).toEqual({ x: 9.327, y: 45.499 });
	});

	// Il caso che fa la differenza fra un form usabile e uno irritante: chi ha
	// già scritto "Casa" non deve vederselo cancellare scegliendo un indirizzo.
	it("keeps what the customer already typed", () => {
		const previous = {
			...emptyAddressForm(),
			label: "Casa",
			recipientName: "Mario Rossi",
			phone: "0212345",
			isDefault: true,
		};

		const form = suggestionToAddressForm(SUGGESTION, previous);

		expect(form.label).toBe("Casa");
		expect(form.recipientName).toBe("Mario Rossi");
		expect(form.phone).toBe("0212345");
		expect(form.isDefault).toBe(true);
	});

	it("leaves the zip empty when the geocoder has none", () => {
		const form = suggestionToAddressForm(
			{ ...SUGGESTION, zipCode: null },
			emptyAddressForm(),
		);
		expect(form.zipCode).toBe("");
	});

	// Comune non risolto: nessun id, e i candidati viaggiano col form perché è
	// la UI a dover chiedere quale dei due omonimi è quello giusto.
	it("carries the candidates when the municipality is ambiguous", () => {
		const candidates = [
			{ id: "m-castro-bg", name: "Castro", provinceAcronym: "BG" },
			{ id: "m-castro-le", name: "Castro", provinceAcronym: "LE" },
		];

		const form = suggestionToAddressForm(
			{ ...SUGGESTION, municipality: null, municipalityCandidates: candidates },
			emptyAddressForm(),
		);

		expect(form.municipalityId).toBeNull();
		expect(form.municipalityCandidates).toEqual(candidates);
	});
});

describe("addressToAddressForm", () => {
	it("maps a saved address into form values, nulls becoming empty strings", () => {
		const form = addressToAddressForm({
			label: null,
			recipientName: "Mario Rossi",
			phone: null,
			addressLine1: "Via Roma 12",
			addressLine2: "Scala B",
			zipCode: "20096",
			municipality: MILANO,
			location: { x: 9.327, y: 45.499 },
			isDefault: true,
		});

		expect(form.label).toBe("");
		expect(form.phone).toBe("");
		expect(form.recipientName).toBe("Mario Rossi");
		expect(form.addressLine2).toBe("Scala B");
		expect(form.municipalityId).toBe("m-mi");
		expect(form.isDefault).toBe(true);
	});
});

describe("validateAddressForm", () => {
	function validForm() {
		return suggestionToAddressForm(SUGGESTION, emptyAddressForm());
	}

	it("accepts a form filled from a suggestion", () => {
		const errors = validateAddressForm(validForm());
		expect(errors).toEqual({});
		expect(isAddressFormValid(errors)).toBe(true);
	});

	it("requires the street line", () => {
		const errors = validateAddressForm({ ...validForm(), addressLine1: "   " });
		expect(errors.addressLine1).toBe("required");
		expect(isAddressFormValid(errors)).toBe(false);
	});

	it("requires the municipality", () => {
		const errors = validateAddressForm({
			...validForm(),
			municipalityId: null,
		});
		expect(errors.municipalityId).toBe("required");
	});

	it("requires a position", () => {
		const errors = validateAddressForm({ ...validForm(), location: null });
		expect(errors.location).toBe("required");
	});

	it("requires the zip", () => {
		const errors = validateAddressForm({ ...validForm(), zipCode: "" });
		expect(errors.zipCode).toBe("required");
	});

	// Cinque cifre: è il pattern che l'API impone, non una nostra preferenza.
	it("rejects a zip that is not five digits", () => {
		expect(
			validateAddressForm({ ...validForm(), zipCode: "2009" }).zipCode,
		).toBe("format");
		expect(
			validateAddressForm({ ...validForm(), zipCode: "2O096" }).zipCode,
		).toBe("format");
	});
});

describe("addressFormToBody", () => {
	it("trims the values and sends the position", () => {
		const body = addressFormToBody({
			...suggestionToAddressForm(SUGGESTION, emptyAddressForm()),
			label: "  Casa  ",
			addressLine2: " Scala B ",
		});

		expect(body.label).toBe("Casa");
		expect(body.addressLine1).toBe("Via Roma 12");
		expect(body.addressLine2).toBe("Scala B");
		expect(body.municipalityId).toBe("m-mi");
		expect(body.zipCode).toBe("20096");
		expect(body.location).toEqual({ x: 9.327, y: 45.499 });
		expect(body.isDefault).toBe(false);
	});

	// `phone` ha un minimo di 5 caratteri lato API: mandarlo vuoto sarebbe un
	// 422, quindi quando è vuoto non lo si manda affatto.
	it("omits an empty phone but keeps a cleared label", () => {
		const body = addressFormToBody({
			...suggestionToAddressForm(SUGGESTION, emptyAddressForm()),
			label: "",
			phone: "   ",
		});

		expect(body).not.toHaveProperty("phone");
		expect(body.label).toBe("");
	});
});
