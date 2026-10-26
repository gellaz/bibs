import { readFileSync } from "node:fs";
import { CompanyBody, DocumentBody, PersonalInfoBody } from "@bibs/api/schemas";
import type { Resolver } from "react-hook-form";
import { afterEach, describe, expect, it } from "vitest";
import { CreateProductFormBody } from "@/features/products/lib/product-form-schema";
import { storeFormSchema } from "@/features/stores/components/store-form";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { schemaResolver } from "./schema-errors";

// I messaggi d'errore dei cinque form sugli schemi condivisi con l'API
// (prodotto, negozio, anagrafica, documento, azienda), campo per campo, in
// italiano e in inglese. L'atteso `form-errors.fixture.json` è stato generato
// dai resolver di prima (commit «atteso dei messaggi d'errore dei form
// condivisi») e non si tocca: i resolver di oggi danno gli stessi messaggi
// sugli stessi campi.

/** Il resolver di ogni form, costruito come nel form. */
const RESOLVERS: Record<string, Resolver<any>> = {
	product: schemaResolver(CreateProductFormBody),
	store: schemaResolver(storeFormSchema),
	personalInfo: schemaResolver(PersonalInfoBody),
	document: schemaResolver(DocumentBody),
	company: schemaResolver(CompanyBody),
};

/** Chiave tolta dal valore (campo mai toccato), diversa da `undefined`. */
const MISSING = Symbol("missing");
type Patch = Record<string, unknown>;

const BASE: Record<string, Patch> = {
	product: {
		name: "Pane",
		description: "",
		price: "9.99",
		vatRate: "22",
		productCategoryId: undefined,
		ean: undefined,
		brandId: undefined,
		brandName: undefined,
	},
	store: {
		name: "Bottega",
		description: "",
		addressLine1: "Via Roma 1",
		addressLine2: "",
		municipalityId: "m1",
		zipCode: "40100",
		websiteUrl: undefined,
		phoneNumbers: [],
		location: { x: 11.34, y: 44.49 },
	},
	personalInfo: {
		firstName: "Mario",
		lastName: "Rossi",
		citizenship: "IT",
		birthCountry: "IT",
		birthDate: "1980-01-01",
		residenceCountry: "IT",
		residenceMunicipalityId: "m1",
		residenceAddress: "Via Roma 1",
		residenceZipCode: "00100",
	},
	document: {
		documentType: "identity_card",
		documentNumber: "CA12345AB",
		documentExpiry: "2030-01-01",
		documentIssuedMunicipalityId: "m1",
	},
	company: {
		businessName: "Bottega Srl",
		vatNumber: "12345678901",
		legalForm: "SRL",
		addressLine1: "Via Roma 1",
		country: "IT",
		municipalityId: "m1",
		zipCode: "40100",
	},
};

const long = (n: number) => "a".repeat(n);
const emoji = (n: number) => "😀".repeat(n);

/** [nome del caso, campi cambiati rispetto a BASE] per form. */
const CASES: Record<string, [string, Patch][]> = {
	product: [
		["valido", {}],
		[
			"form appena aperto",
			{ name: "", description: "", price: "", vatRate: "22" },
		],
		["name vuoto", { name: "" }],
		["name assente", { name: MISSING }],
		["name undefined", { name: undefined }],
		["name null", { name: null }],
		["name numero", { name: 5 }],
		["name spazio", { name: " " }],
		["name 200", { name: long(200) }],
		["name 201", { name: long(201) }],
		["name 100 emoji", { name: emoji(100) }],
		["name 101 emoji", { name: emoji(101) }],
		["description 2000", { description: long(2000) }],
		["description 2001", { description: long(2001) }],
		["description null", { description: null }],
		["description numero", { description: 5 }],
		["description assente", { description: MISSING }],
		["price vuoto", { price: "" }],
		["price assente", { price: MISSING }],
		["price 9", { price: "9" }],
		["price 9.9", { price: "9.9" }],
		["price 9.999", { price: "9.999" }],
		["price abc", { price: "abc" }],
		["price -1", { price: "-1" }],
		["price virgola", { price: "9,99" }],
		["price numero", { price: 9.99 }],
		["vatRate 7", { vatRate: "7" }],
		["vatRate vuoto", { vatRate: "" }],
		["vatRate assente", { vatRate: MISSING }],
		["vatRate 10", { vatRate: "10" }],
		["vatRate numero", { vatRate: 22 }],
		["vatRate null", { vatRate: null }],
		["productCategoryId null", { productCategoryId: null }],
		["productCategoryId testo", { productCategoryId: "cat" }],
		["productCategoryId vuoto", { productCategoryId: "" }],
		["productCategoryId numero", { productCategoryId: 5 }],
		["ean vuoto", { ean: "" }],
		["ean 7 cifre", { ean: "1234567" }],
		["ean 8 cifre", { ean: "12345678" }],
		["ean 12 cifre", { ean: "123456789012" }],
		["ean 13 cifre", { ean: "1234567890123" }],
		["ean lettere", { ean: "abcdefgh" }],
		["ean null", { ean: null }],
		["brandId testo", { brandId: "b1" }],
		["brandId numero", { brandId: 5 }],
		["brandName vuoto", { brandName: "" }],
		["brandName 120", { brandName: long(120) }],
		["brandName 121", { brandName: long(121) }],
		["brandName null", { brandName: null }],
		[
			"tutto sbagliato",
			{
				name: long(201),
				description: long(2001),
				price: "x",
				vatRate: "7",
				productCategoryId: 5,
				ean: "1",
				brandId: 5,
				brandName: "",
			},
		],
	],
	store: [
		["valido", {}],
		[
			"form appena aperto",
			{
				name: "",
				addressLine1: "",
				municipalityId: "",
				zipCode: "",
				location: MISSING,
			},
		],
		["name vuoto", { name: "" }],
		["name assente", { name: MISSING }],
		["name 100", { name: long(100) }],
		["name 101", { name: long(101) }],
		["name null", { name: null }],
		["description 1001", { description: long(1001) }],
		["description null", { description: null }],
		["addressLine1 vuoto", { addressLine1: "" }],
		["addressLine1 assente", { addressLine1: MISSING }],
		["addressLine1 201", { addressLine1: long(201) }],
		["addressLine2 201", { addressLine2: long(201) }],
		["addressLine2 assente", { addressLine2: MISSING }],
		["municipalityId vuoto", { municipalityId: "" }],
		["municipalityId assente", { municipalityId: MISSING }],
		["municipalityId numero", { municipalityId: 5 }],
		["zipCode vuoto", { zipCode: "" }],
		["zipCode 4 cifre", { zipCode: "1234" }],
		["zipCode 6 cifre", { zipCode: "123456" }],
		["zipCode lettere", { zipCode: "12a45" }],
		["zipCode spazio", { zipCode: " 40100" }],
		["location assente", { location: MISSING }],
		["location undefined", { location: undefined }],
		["location null", { location: null }],
		["location testo", { location: "qui" }],
		["location vuota", { location: {} }],
		["location x 181", { location: { x: 181, y: 0 } }],
		["location x -181", { location: { x: -181, y: 0 } }],
		["location y 91", { location: { x: 0, y: 91 } }],
		["location y -91", { location: { x: 0, y: -91 } }],
		["location stringhe", { location: { x: "1", y: "2" } }],
		["country I", { country: "I" }],
		["country ITA", { country: "ITA" }],
		["country vuoto", { country: "" }],
		["country IT", { country: "IT" }],
		["country numero", { country: 5 }],
		["categoryId testo", { categoryId: "c1" }],
		["categoryId numero", { categoryId: 5 }],
		["websiteUrl null", { websiteUrl: null }],
		["websiteUrl vuoto", { websiteUrl: "" }],
		["websiteUrl ftp", { websiteUrl: "ftp://x" }],
		["websiteUrl https", { websiteUrl: "https://bibs.it" }],
		["websiteUrl http con query", { websiteUrl: "http://bibs.it/n?x=1" }],
		["websiteUrl senza schema", { websiteUrl: "bibs.it" }],
		["websiteUrl solo schema", { websiteUrl: "http://" }],
		["websiteUrl mailto", { websiteUrl: "mailto:a@b.it" }],
		["websiteUrl testo", { websiteUrl: "non un sito" }],
		["websiteUrl 500", { websiteUrl: `https://${long(492)}` }],
		["websiteUrl 501", { websiteUrl: `https://${long(493)}` }],
		["websiteUrl 501 non url", { websiteUrl: long(501) }],
		["websiteUrl numero", { websiteUrl: 5 }],
		["phoneNumbers testo", { phoneNumbers: "x" }],
		["phoneNumbers null", { phoneNumbers: null }],
		["phone corto", { phoneNumbers: [{ label: "", number: "12" }] }],
		["phone valido", { phoneNumbers: [{ label: "Casa", number: "12345" }] }],
		["phone vuoto", { phoneNumbers: [{ label: "", number: "" }] }],
		["phone senza numero", { phoneNumbers: [{ label: "Casa" }] }],
		["phone numero numerico", { phoneNumbers: [{ number: 12345 }] }],
		["phone 31", { phoneNumbers: [{ number: long(31) }] }],
		[
			"phone label 51",
			{ phoneNumbers: [{ label: long(51), number: "12345" }] },
		],
		[
			"phone position -1",
			{ phoneNumbers: [{ number: "12345", position: -1 }] },
		],
		[
			"phone position 1.5",
			{ phoneNumbers: [{ number: "12345", position: 1.5 }] },
		],
		[
			"phone position stringa",
			{ phoneNumbers: [{ number: "12345", position: "1" }] },
		],
		[
			"phone seconda riga",
			{
				phoneNumbers: [
					{ label: "", number: "12345" },
					{ label: "", number: "1" },
				],
			},
		],
		["openingHours null", { openingHours: null }],
		[
			"openingHours valido",
			{
				openingHours: [
					{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }] },
				],
			},
		],
		[
			"come il test del resolver",
			{
				name: "",
				zipCode: "12a",
				websiteUrl: "ftp://x",
				phoneNumbers: [{ label: "", number: "12" }],
				location: MISSING,
			},
		],
	],
	personalInfo: [
		["valido", {}],
		[
			"form appena aperto",
			{
				firstName: "",
				lastName: "",
				citizenship: MISSING,
				birthCountry: MISSING,
				birthDate: "",
				residenceCountry: MISSING,
				residenceMunicipalityId: MISSING,
				residenceAddress: "",
				residenceZipCode: "",
			},
		],
		["firstName vuoto", { firstName: "" }],
		["firstName assente", { firstName: MISSING }],
		["firstName 101", { firstName: long(101) }],
		["firstName null", { firstName: null }],
		["lastName vuoto", { lastName: "" }],
		["lastName 101", { lastName: long(101) }],
		["citizenship vuoto", { citizenship: "" }],
		["citizenship I", { citizenship: "I" }],
		["citizenship ITA", { citizenship: "ITA" }],
		["birthCountry assente", { birthCountry: MISSING }],
		["birthCountry ITA", { birthCountry: "ITA" }],
		["residenceCountry I", { residenceCountry: "I" }],
		["residenceCountry ITA", { residenceCountry: "ITA" }],
		["birthDate vuoto", { birthDate: "" }],
		["birthDate 30 febbraio", { birthDate: "2024-02-30" }],
		["birthDate mese 13", { birthDate: "1980-13-01" }],
		["birthDate gg/mm/aaaa", { birthDate: "01/01/1980" }],
		["birthDate senza zeri", { birthDate: "1980-1-1" }],
		["birthDate 29 febbraio", { birthDate: "2024-02-29" }],
		["birthDate numero", { birthDate: 19800101 }],
		["residenceMunicipalityId vuoto", { residenceMunicipalityId: "" }],
		["residenceMunicipalityId numero", { residenceMunicipalityId: 5 }],
		["residenceAddress vuoto", { residenceAddress: "" }],
		["residenceAddress 201", { residenceAddress: long(201) }],
		["residenceZipCode vuoto", { residenceZipCode: "" }],
		["residenceZipCode 4 cifre", { residenceZipCode: "1234" }],
		["residenceZipCode lettere", { residenceZipCode: "abcde" }],
	],
	document: [
		["valido", {}],
		[
			"form appena aperto",
			{
				documentType: MISSING,
				documentNumber: "",
				documentExpiry: "",
				documentIssuedMunicipalityId: MISSING,
			},
		],
		["documentType vuoto", { documentType: "" }],
		["documentType sconosciuto", { documentType: "x" }],
		["documentType passaporto", { documentType: "passport" }],
		["documentType null", { documentType: null }],
		["documentNumber vuoto", { documentNumber: "" }],
		["documentNumber 4", { documentNumber: "1234" }],
		["documentNumber 21", { documentNumber: long(21) }],
		["documentNumber 2 emoji", { documentNumber: emoji(2) }],
		["documentNumber 3 emoji", { documentNumber: emoji(3) }],
		["documentExpiry vuoto", { documentExpiry: "" }],
		["documentExpiry 30 febbraio", { documentExpiry: "2030-02-30" }],
		["documentExpiry con barre", { documentExpiry: "2030/01/01" }],
		[
			"documentIssuedMunicipalityId vuoto",
			{ documentIssuedMunicipalityId: "" },
		],
		[
			"documentIssuedMunicipalityId assente",
			{ documentIssuedMunicipalityId: MISSING },
		],
	],
	company: [
		["valido", {}],
		[
			"form appena aperto",
			{
				businessName: MISSING,
				vatNumber: MISSING,
				legalForm: MISSING,
				addressLine1: MISSING,
				municipalityId: MISSING,
				zipCode: MISSING,
			},
		],
		["businessName vuoto", { businessName: "" }],
		["businessName 201", { businessName: long(201) }],
		["vatNumber vuoto", { vatNumber: "" }],
		["vatNumber 10 cifre", { vatNumber: "1234567890" }],
		["vatNumber 12 cifre", { vatNumber: "123456789012" }],
		["vatNumber lettera", { vatNumber: "1234567890a" }],
		["legalForm vuoto", { legalForm: "" }],
		["legalForm 101", { legalForm: long(101) }],
		["addressLine1 vuoto", { addressLine1: "" }],
		["addressLine1 201", { addressLine1: long(201) }],
		["country vuoto", { country: "" }],
		["country I", { country: "I" }],
		["country ITA", { country: "ITA" }],
		["country assente", { country: MISSING }],
		["country null", { country: null }],
		["municipalityId vuoto", { municipalityId: "" }],
		["zipCode vuoto", { zipCode: "" }],
		["zipCode 4 cifre", { zipCode: "4010" }],
	],
};

function formValues(form: string, patch: Patch): Patch {
	const value: Patch = { ...BASE[form] };
	for (const [key, v] of Object.entries(patch)) {
		if (v === MISSING) delete value[key];
		else value[key] = v;
	}
	return value;
}

/** Gli errori del resolver come `percorso → messaggio`. */
function flatten(node: unknown, prefix = ""): Record<string, string> {
	const out: Record<string, string> = {};
	if (!node || typeof node !== "object") return out;
	for (const [key, value] of Object.entries(node)) {
		if (key === "ref" || !value || typeof value !== "object") continue;
		const path = prefix ? `${prefix}.${key}` : key;
		const { message } = value as { message?: unknown };
		if (typeof message === "string") out[path] = message;
		Object.assign(out, flatten(value, path));
	}
	return out;
}

async function messages(form: string, patch: Patch, locale: "it" | "en") {
	overwriteGetLocale(() => locale);
	const { errors } = await RESOLVERS[form](
		formValues(form, patch) as never,
		undefined,
		{
			fields: {},
			shouldUseNativeValidation: false,
		},
	);
	return flatten(errors);
}

type Fixture = Record<
	string,
	Record<string, Record<string, Record<string, string>>>
>;

const fixture: Fixture = JSON.parse(
	readFileSync(new URL("./form-errors.fixture.json", import.meta.url), "utf8"),
);

const originalGetLocale = getLocale;
afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

describe("messaggi d'errore dei form sugli schemi condivisi", () => {
	for (const form of Object.keys(CASES)) {
		it(form, async () => {
			const actual: Fixture[string] = {};
			for (const [name, patch] of CASES[form])
				actual[name] = {
					it: await messages(form, patch, "it"),
					en: await messages(form, patch, "en"),
				};
			expect(actual).toEqual(fixture[form]);
		});
	}
});
