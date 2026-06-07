import { describe, expect, it } from "bun:test";
import { ServiceError } from "@/lib/errors";
import { parseCsv } from "@/lib/utils/csv";

describe("parseCsv", () => {
	// === the bug ===
	it("keeps a quoted embedded newline inside one field", () => {
		const csv = 'name,description\nFoo,"line one\nline two"\nBar,baz';
		const { headers, rows } = parseCsv(csv);
		expect(headers).toEqual(["name", "description"]);
		expect(rows).toEqual([
			["Foo", "line one\nline two"],
			["Bar", "baz"],
		]);
	});

	it("keeps quoted CRLF newlines (Excel export) inside one field", () => {
		const csv = 'name,description\r\nFoo,"line one\r\nline two"\r\nBar,baz';
		const { rows } = parseCsv(csv);
		expect(rows).toEqual([
			["Foo", "line one\nline two"],
			["Bar", "baz"],
		]);
	});

	it("does not misalign rows AFTER a multi-line field", () => {
		const csv = 'name,price\n"Multi\nline product",10.00\nNormale,5.00';
		const { rows } = parseCsv(csv);
		expect(rows).toHaveLength(2);
		expect(rows[1]).toEqual(["Normale", "5.00"]);
	});

	// === behavior preservation (the consumers rely on every one of these) ===
	it("lowercases headers", () => {
		expect(parseCsv("Name,PRICE\nx,1.00").headers).toEqual(["name", "price"]);
	});

	it("trims fields", () => {
		expect(parseCsv("name\n  spaced  ").rows).toEqual([["spaced"]]);
	});

	it("unescapes doubled quotes", () => {
		expect(parseCsv('name\n"say ""hi"""').rows).toEqual([['say "hi"']]);
	});

	it("skips blank lines between records", () => {
		expect(parseCsv("name\nfoo\n\n   \nbar\n").rows).toEqual([
			["foo"],
			["bar"],
		]);
	});

	it("keeps a whitespace-only QUOTED field as an empty-string row", () => {
		// admin-category-import.test.ts depends on '"   "' surfacing as a
		// row-level error (row kept, value trimmed to "") — NOT being dropped
		const { rows } = parseCsv('name\nfoo\n"   "\nbar');
		expect(rows).toEqual([["foo"], [""], ["bar"]]);
	});

	it("keeps comma-only lines as empty-field rows", () => {
		expect(parseCsv("a,b,c\n,,").rows).toEqual([["", "", ""]]);
	});

	it("throws ServiceError(400) on empty input", () => {
		expect(() => parseCsv("")).toThrow(ServiceError);
		expect(() => parseCsv("\n  \n")).toThrow(ServiceError);
	});

	it("throws ServiceError(400) on an unterminated quoted field", () => {
		expect(() => parseCsv('name\n"never closed')).toThrow(ServiceError);
	});
});

describe("parseCsv — lenient stray quotes (quote-mode only at field start)", () => {
	it("treats a quote mid-field as a literal character", () => {
		const { rows } = parseCsv('name,price\nMonitor 27",199.00\nO"Brien,5.00');
		expect(rows).toEqual([
			['Monitor 27"', "199.00"],
			['O"Brien', "5.00"],
		]);
	});

	it("still opens quote-mode after leading whitespace", () => {
		const { rows } = parseCsv('a,b\nfoo, "x, y"');
		expect(rows).toEqual([["foo", "x, y"]]);
	});

	it("still rejects a genuinely unterminated quoted field", () => {
		expect(() => parseCsv('name\n"never closed')).toThrow(ServiceError);
	});
});
