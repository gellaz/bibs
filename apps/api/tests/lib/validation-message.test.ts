import { describe, expect, it } from "bun:test";
import { Elysia, type TSchema, t, ValidationError } from "elysia";
import "@/lib/schemas/forms/formats";
import { validationMessage } from "@/lib/validation-message";

// Passa davvero da Elysia: i dettagli dell'errore (tipo, path, rami degli
// Union di t.Integer/t.Nullable) sono quelli che il validatore produce.
async function bodyMessage(schema: TSchema, body: unknown): Promise<string> {
	let message = "";
	const app = new Elysia()
		.onError(({ error }) => {
			if (error instanceof ValidationError) message = validationMessage(error);
			return "";
		})
		.post("/", () => "ok", { body: schema });
	await app.handle(
		new Request("http://localhost/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
	return message;
}

async function queryMessage(schema: TSchema, search: string): Promise<string> {
	let message = "";
	const app = new Elysia()
		.onError(({ error }) => {
			if (error instanceof ValidationError) message = validationMessage(error);
			return "";
		})
		.get("/", () => "ok", { query: schema });
	await app.handle(new Request(`http://localhost/${search}`));
	return message;
}

describe("validationMessage — campi e tipi", () => {
	it("campo mancante nel body: obbligatorio", async () => {
		expect(await bodyMessage(t.Object({ name: t.String() }), {})).toBe(
			"Nome: campo obbligatorio",
		);
	});

	it("campo mancante in query: obbligatorio", async () => {
		expect(
			await queryMessage(t.Object({ storeId: t.String() }), "?other=1"),
		).toBe("Negozio: campo obbligatorio");
	});

	it("tipo sbagliato: testo, numero, vero/falso", async () => {
		expect(await bodyMessage(t.Object({ name: t.String() }), { name: 3 })).toBe(
			"Nome: deve essere un testo",
		);
		expect(
			await bodyMessage(t.Object({ price: t.Number() }), { price: "x" }),
		).toBe("Prezzo: deve essere un numero");
		expect(
			await bodyMessage(t.Object({ isActive: t.Boolean() }), { isActive: "x" }),
		).toBe("Attivo: deve essere vero o falso");
	});

	it("t.Integer con un decimale: numero intero", async () => {
		expect(
			await bodyMessage(t.Object({ quantity: t.Integer() }), { quantity: 1.5 }),
		).toBe("Quantità: deve essere un numero intero");
	});

	it("t.Integer sotto il minimo e sopra il massimo", async () => {
		const schema = t.Object({
			quantity: t.Integer({ minimum: 1, maximum: 99 }),
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
			await bodyMessage(
				t.Object({ price: t.Number({ exclusiveMinimum: 0 }) }),
				{
					price: 0,
				},
			),
		).toBe("Prezzo: deve essere maggiore di 0");
	});

	it("lunghezza minima e massima del testo", async () => {
		const schema = t.Object({ name: t.String({ minLength: 2, maxLength: 5 }) });
		expect(await bodyMessage(schema, { name: "a" })).toBe(
			"Nome: almeno 2 caratteri",
		);
		expect(await bodyMessage(schema, { name: "abcdef" })).toBe(
			"Nome: al massimo 5 caratteri",
		);
	});

	it("minLength 1 su testo vuoto: obbligatorio", async () => {
		expect(
			await bodyMessage(t.Object({ name: t.String({ minLength: 1 }) }), {
				name: "",
			}),
		).toBe("Nome: campo obbligatorio");
	});

	it("pattern: formato non valido", async () => {
		expect(
			await bodyMessage(
				t.Object({ zipCode: t.String({ pattern: "^\\d{5}$" }) }),
				{
					zipCode: "ab",
				},
			),
		).toBe("CAP: formato non valido");
	});

	it("formati: email, uuid, calendar-date, uri, date-time", async () => {
		const f = (format: string) => t.Object({ x: t.String({ format }) });
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
			await bodyMessage(
				t.Object({ type: t.Union([t.Literal("a"), t.Literal("b")]) }),
				{ type: "c" },
			),
		).toBe("Tipo: valore non ammesso");
		expect(
			await bodyMessage(t.Object({ type: t.Literal("a") }), { type: "c" }),
		).toBe("Tipo: valore non ammesso");
	});

	it("t.Nullable: la regola del ramo non nullo", async () => {
		expect(
			await bodyMessage(
				t.Object({ note: t.Nullable(t.String({ maxLength: 3 })) }),
				{
					note: "abcd",
				},
			),
		).toBe("Note: al massimo 3 caratteri");
	});

	it("t.Date non valida", async () => {
		expect(
			await bodyMessage(t.Object({ startsAt: t.Date() }), { startsAt: "nope" }),
		).toBe("Inizio: data non valida");
	});

	it("array: elementi minimi, massimi, duplicati", async () => {
		const schema = t.Object({
			storeIds: t.Array(t.String(), {
				minItems: 1,
				maxItems: 2,
				uniqueItems: true,
			}),
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
				t.Object({
					items: t.Array(t.Object({ quantity: t.Integer({ minimum: 1 }) })),
				}),
				{ items: [{ quantity: 1 }, { quantity: 0 }] },
			),
		).toBe("Quantità (riga 2): deve essere almeno 1");
	});

	it("campo annidato non in dizionario: path tecnico", async () => {
		expect(
			await bodyMessage(
				t.Object({ location: t.Object({ zz: t.Number({ maximum: 90 }) }) }),
				{ location: { zz: 91 } },
			),
		).toBe("location.zz: deve essere al massimo 90");
	});

	it("il title dello schema vince sul dizionario", async () => {
		expect(
			await queryMessage(
				t.Object({
					limit: t.Integer({ maximum: 10, title: "Numero di suggerimenti" }),
				}),
				"?limit=2.5",
			),
		).toBe("Numero di suggerimenti: deve essere un numero intero");
	});

	it("query con coercizione senza path: solo la regola", async () => {
		expect(
			await queryMessage(
				t.Object({ page: t.Integer({ minimum: 1 }) }),
				"?page=0",
			),
		).toBe("Valore non valido: deve essere almeno 1");
	});
});

describe("validationMessage — messaggi già scritti e ripieghi", () => {
	it("usa l'error: dello schema così com'è", async () => {
		expect(
			await bodyMessage(
				t.Object({
					name: t.String({ minLength: 1, error: "Il nome è obbligatorio" }),
				}),
				{ name: "" },
			),
		).toBe("Il nome è obbligatorio");
	});

	it("body che non è un oggetto: richiesta non valida", async () => {
		expect(await bodyMessage(t.Array(t.String()), { a: 1 })).toBe(
			"Richiesta non valida",
		);
	});

	it("regola non mappata: valore non valido", async () => {
		expect(
			await bodyMessage(t.Object({ step: t.Integer({ multipleOf: 5 }) }), {
				step: 3,
			}),
		).toBe("step: valore non valido");
	});
});
