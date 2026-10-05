import { afterAll, describe, expect, it } from "vitest";
import { type ZodType, z } from "zod";
import { type ZodIssueRule, zodIssueRule } from "./zod-issue-rule";

// Le regole delle issue prodotte da zod vero, non da issue scritte a mano,
// passate dalla stessa via delle app: l'error map globale.
let out: ZodIssueRule[] = [];
z.config({
	localeError: (issue) => {
		out.push(zodIssueRule(issue));
		return "x";
	},
});
afterAll(() => {
	z.config(z.locales.en());
});

function rules(schema: ZodType, value: unknown): ZodIssueRule[] {
	out = [];
	const result = schema.safeParse(value);
	if (result.success) throw new Error("expected a validation error");
	// zod 4 costruisce i messaggi alla prima lettura delle issue.
	void result.error.issues;
	return out;
}

describe("zodIssueRule", () => {
	it("treats an empty or missing string as required", () => {
		expect(rules(z.string().min(1), "")).toEqual([{ kind: "required" }]);
		expect(rules(z.string().trim().min(1), "  ")).toEqual([
			{ kind: "required" },
		]);
		expect(rules(z.object({ a: z.string() }), {})).toEqual([
			{ kind: "required" },
		]);
		expect(rules(z.string(), null)).toEqual([{ kind: "required" }]);
	});

	it("maps string lengths", () => {
		expect(rules(z.string().min(2), "I")).toEqual([
			{ kind: "minLength", limit: 2 },
		]);
		expect(rules(z.string().max(2), "ITA")).toEqual([
			{ kind: "maxLength", limit: 2 },
		]);
		expect(rules(z.string().length(5), "1")).toEqual([
			{ kind: "minLength", limit: 5 },
		]);
	});

	it("maps number types and bounds, coerced like the promotion percent", () => {
		const percent = z.coerce.number().int().min(1).max(99);
		expect(rules(percent, "abc")).toEqual([{ kind: "number" }]);
		expect(rules(percent, "1.5")).toEqual([{ kind: "integer" }]);
		expect(rules(percent, "0")).toEqual([{ kind: "minimum", limit: 1 }]);
		expect(rules(percent, "100")).toEqual([{ kind: "maximum", limit: 99 }]);
		expect(rules(z.number().gt(0), 0)).toEqual([
			{ kind: "exclusiveMinimum", limit: 0 },
		]);
		expect(rules(z.number().lt(10), 10)).toEqual([
			{ kind: "exclusiveMaximum", limit: 10 },
		]);
	});

	it("maps the other types", () => {
		expect(rules(z.string(), 1)).toEqual([{ kind: "string" }]);
		expect(rules(z.boolean(), "x")).toEqual([{ kind: "boolean" }]);
		expect(rules(z.array(z.string()), "x")).toEqual([{ kind: "array" }]);
		expect(rules(z.date(), new Date("x"))).toEqual([{ kind: "date" }]);
		expect(
			rules(z.date().min(new Date(2020, 0, 1)), new Date(2019, 0, 1)),
		).toEqual([{ kind: "date" }]);
	});

	it("maps formats to the TypeBox names, patterns to pattern", () => {
		expect(rules(z.string().email(), "a@b")).toEqual([
			{ kind: "format", format: "email" },
		]);
		expect(rules(z.url(), "x")).toEqual([{ kind: "format", format: "uri" }]);
		expect(rules(z.iso.datetime(), "x")).toEqual([
			{ kind: "format", format: "date-time" },
		]);
		expect(rules(z.iso.date(), "x")).toEqual([
			{ kind: "format", format: "calendar-date" },
		]);
		expect(rules(z.uuid(), "x")).toEqual([{ kind: "format", format: "uuid" }]);
		expect(rules(z.ipv4(), "x")).toEqual([{ kind: "format", format: "ipv4" }]);
		expect(rules(z.string().regex(/^\d{5}$/), "12a")).toEqual([
			{ kind: "pattern" },
		]);
		expect(rules(z.string().startsWith("IT"), "FR")).toEqual([
			{ kind: "pattern" },
		]);
	});

	it("maps array sizes", () => {
		expect(rules(z.array(z.string()).min(2), ["a"])).toEqual([
			{ kind: "minItems", limit: 2 },
		]);
		expect(rules(z.array(z.string()).max(1), ["a", "b"])).toEqual([
			{ kind: "maxItems", limit: 1 },
		]);
	});

	it("maps enums and literals to not allowed, the rest to invalid", () => {
		expect(rules(z.enum(["a", "b"]), "c")).toEqual([{ kind: "notAllowed" }]);
		expect(rules(z.literal("a"), "c")).toEqual([{ kind: "notAllowed" }]);
		expect(
			rules(
				z.string().refine(() => false),
				"x",
			),
		).toEqual([{ kind: "invalid" }]);
		expect(rules(z.number().multipleOf(5), 3)).toEqual([{ kind: "invalid" }]);
		// Le issue dei rami passano anche loro dall'error map; quella del form è l'ultima.
		expect(rules(z.union([z.string(), z.number()]), true).at(-1)).toEqual({
			kind: "invalid",
		});
	});
});
