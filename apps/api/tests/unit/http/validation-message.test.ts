import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { moduleApp } from "@/http/app";
import { v } from "@/http/validator";
import type { FormatName } from "@/schemas/formats";
import { zDate, zFormat, zInteger, zString } from "@/schemas/t";

// Il messaggio del 422 passa davvero dal validatore (`v()`): i dettagli
// dell'errore (tipo, path, rami di zInteger/nullable) sono quelli che produce
// sulle issue di Zod. Gli schemi sono i gemelli di quelli di prima che il test
// usava fino a U11 (gli stessi dei casi «vm:» di `tests/unit/http/parity-cases.ts`);
// le stringhe attese sono le stesse.
async function bodyMessage(schema: z.ZodType, body: unknown): Promise<string> {
	const app = moduleApp().post("/", v("json", schema), (c) => c.text("ok"));
	const res = await app.request("http://localhost/", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return res.status === 422
		? ((await res.json()) as { message: string }).message
		: "";
}

async function queryMessage(
	schema: z.ZodType,
	search: string,
): Promise<string> {
	const app = moduleApp().get("/", v("query", schema), (c) => c.text("ok"));
	const res = await app.request(`http://localhost/${search}`);
	return res.status === 422
		? ((await res.json()) as { message: string }).message
		: "";
}

describe("validationMessage — campi e tipi", () => {
	it("campo mancante nel body: obbligatorio", async () => {
		expect(await bodyMessage(z.object({ name: z.string() }), {})).toBe(
			"Nome: campo obbligatorio",
		);
	});

	it("campo mancante in query: obbligatorio", async () => {
		expect(
			await queryMessage(z.object({ storeId: z.string() }), "?other=1"),
		).toBe("Negozio: campo obbligatorio");
	});

	it("tipo sbagliato: testo, numero, vero/falso", async () => {
		expect(await bodyMessage(z.object({ name: z.string() }), { name: 3 })).toBe(
			"Nome: deve essere un testo",
		);
		expect(
			await bodyMessage(z.object({ price: z.number() }), { price: "x" }),
		).toBe("Prezzo: deve essere un numero");
		expect(
			await bodyMessage(z.object({ isActive: z.boolean() }), { isActive: "x" }),
		).toBe("Attivo: deve essere vero o falso");
	});

	it("t.Integer con un decimale: numero intero", async () => {
		expect(
			await bodyMessage(z.object({ quantity: zInteger() }), { quantity: 1.5 }),
		).toBe("Quantità: deve essere un numero intero");
	});

	it("t.Integer sotto il minimo e sopra il massimo", async () => {
		const schema = z.object({
			quantity: zInteger({ minimum: 1, maximum: 99 }),
		});
		expect(await bodyMessage(schema, { quantity: 0 })).toBe(
			"Quantità: deve essere almeno 1",
		);
		expect(await bodyMessage(schema, { quantity: 100 })).toBe(
			"Quantità: deve essere al massimo 99",
		);
	});

	it("t.Number con exclusiveMinimum", async () => {
		expect(
			await bodyMessage(z.object({ price: z.number().gt(0) }), {
				price: 0,
			}),
		).toBe("Prezzo: deve essere maggiore di 0");
	});

	it("lunghezza minima e massima del testo", async () => {
		const schema = z.object({ name: zString({ minLength: 2, maxLength: 5 }) });
		expect(await bodyMessage(schema, { name: "a" })).toBe(
			"Nome: almeno 2 caratteri",
		);
		expect(await bodyMessage(schema, { name: "abcdef" })).toBe(
			"Nome: al massimo 5 caratteri",
		);
	});

	it("minLength 1 su testo vuoto: obbligatorio", async () => {
		expect(
			await bodyMessage(z.object({ name: zString({ minLength: 1 }) }), {
				name: "",
			}),
		).toBe("Nome: campo obbligatorio");
	});

	it("pattern: formato non valido", async () => {
		expect(
			await bodyMessage(
				z.object({ zipCode: zString({ pattern: "^\\d{5}$" }) }),
				{
					zipCode: "ab",
				},
			),
		).toBe("CAP: formato non valido");
	});

	it("formati: email, uuid, calendar-date, uri, date-time", async () => {
		const f = (format: FormatName) => z.object({ x: zFormat(format) });
		expect(await bodyMessage(f("email"), { x: "no" })).toBe(
			"x: indirizzo email non valido",
		);
		expect(await bodyMessage(f("uuid"), { x: "no" })).toBe(
			"x: identificativo non valido",
		);
		expect(await bodyMessage(f("calendar-date"), { x: "2024-02-31" })).toBe(
			"x: data non valida (AAAA-MM-GG)",
		);
		expect(await bodyMessage(f("uri"), { x: "no" })).toBe(
			"x: indirizzo web non valido",
		);
		expect(await bodyMessage(f("date-time"), { x: "no" })).toBe(
			"x: data e ora non valide",
		);
	});

	it("Union di Literal e Literal singolo: valore non ammesso", async () => {
		expect(
			await bodyMessage(z.object({ type: z.enum(["a", "b"]) }), { type: "c" }),
		).toBe("Tipo: valore non ammesso");
		expect(
			await bodyMessage(z.object({ type: z.literal("a") }), { type: "c" }),
		).toBe("Tipo: valore non ammesso");
	});

	it("t.Nullable: la regola del ramo non nullo", async () => {
		expect(
			await bodyMessage(
				z.object({ note: zString({ maxLength: 3 }).nullable() }),
				{
					note: "abcd",
				},
			),
		).toBe("Note: al massimo 3 caratteri");
	});

	it("t.Date non valida", async () => {
		expect(
			await bodyMessage(z.object({ startsAt: zDate() }), { startsAt: "nope" }),
		).toBe("Inizio: data non valida");
	});

	it("array: elementi minimi, massimi, duplicati", async () => {
		const schema = z.object({
			storeIds: z
				.array(z.string())
				.min(1)
				.max(2)
				.refine((ids) => new Set(ids).size === ids.length, {
					params: { rule: { kind: "uniqueItems" } },
				})
				.meta({ uniqueItems: true }),
		});
		expect(await bodyMessage(schema, { storeIds: [] })).toBe(
			"Negozi: almeno 1 elemento",
		);
		expect(await bodyMessage(schema, { storeIds: ["a", "b", "c"] })).toBe(
			"Negozi: al massimo 2 elementi",
		);
		expect(await bodyMessage(schema, { storeIds: ["a", "a"] })).toBe(
			"Negozi: elementi duplicati",
		);
	});

	it("campo dentro un array: etichetta con la riga", async () => {
		expect(
			await bodyMessage(
				z.object({
					items: z.array(z.object({ quantity: zInteger({ minimum: 1 }) })),
				}),
				{ items: [{ quantity: 1 }, { quantity: 0 }] },
			),
		).toBe("Quantità (riga 2): deve essere almeno 1");
	});

	it("campo annidato non in dizionario: path tecnico", async () => {
		expect(
			await bodyMessage(
				z.object({ location: z.object({ zz: z.number().max(90) }) }),
				{ location: { zz: 91 } },
			),
		).toBe("location.zz: deve essere al massimo 90");
	});

	it("il title dello schema vince sul dizionario", async () => {
		expect(
			await queryMessage(
				z.object({
					limit: zInteger({ maximum: 10, title: "Numero di suggerimenti" }),
				}),
				"?limit=2.5",
			),
		).toBe("Numero di suggerimenti: deve essere un numero intero");
	});

	it("query con coercizione senza path: solo la regola", async () => {
		expect(
			await queryMessage(
				z.object({ page: zInteger({ minimum: 1 }) }),
				"?page=0",
			),
		).toBe("Valore non valido: deve essere almeno 1");
	});
});

describe("validationMessage — messaggi già scritti e ripieghi", () => {
	it("usa l'error: dello schema così com'è", async () => {
		expect(
			await bodyMessage(
				z.object({
					name: zString({ minLength: 1, error: "Il nome è obbligatorio" }),
				}),
				{ name: "" },
			),
		).toBe("Il nome è obbligatorio");
	});

	it("body che non è un oggetto: richiesta non valida", async () => {
		expect(await bodyMessage(z.array(z.string()), { a: 1 })).toBe(
			"Richiesta non valida",
		);
	});

	it("regola non mappata: valore non valido", async () => {
		expect(
			await bodyMessage(z.object({ step: zInteger({ multipleOf: 5 }) }), {
				step: 3,
			}),
		).toBe("step: valore non valido");
	});
});
