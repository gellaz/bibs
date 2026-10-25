// Elysia-registered formats (TypeBox 0.34 FormatRegistry) vs TypeBox 1 built-ins.
import { FormatRegistry } from "@sinclair/typebox";
import "elysia"; // registers its formats
import Format from "typebox/format";

const samples: Record<string, string[]> = {
	email: [
		"a@b.it",
		"A@B.IT",
		"a+b@x.co",
		"a@b",
		"a@b.c",
		"a@localhost",
		"a b@x.it",
		"a@-x.it",
		"è@x.it",
		"a@x..it",
		"a@[1.2.3.4]",
	],
	uuid: [
		"0190a6f8-7b1c-7d2e-8f3a-123456789abc",
		"urn:uuid:0190a6f8-7b1c-7d2e-8f3a-123456789abc",
		"0190A6F8-7B1C-7D2E-8F3A-123456789ABC",
		"nope",
	],
	"date-time": [
		"2026-01-01T10:00:00Z",
		"2026-01-01T10:00:00.123+02:00",
		"2026-01-01 10:00:00",
		"2026-01-01T10:00:00",
		"2026-02-30T10:00:00Z",
		"2026-01-01",
	],
	date: [
		"2026-01-01",
		"2026-02-30",
		"2026-13-01",
		"2026-1-1",
		"2026-01-01T00:00:00Z",
	],
	uri: [
		"https://x.it",
		"http://x",
		"ftp://x.it",
		"mailto:a@b.it",
		"x.it",
		"https://x.it/a b",
	],
};
let diffs = 0;
for (const [fmt, list] of Object.entries(samples)) {
	const elysia = FormatRegistry.Get(fmt);
	const tb1 = Format.Get(fmt);
	for (const s of list) {
		const a = elysia ? elysia(s) : "n/a";
		const b = tb1 ? tb1(s) : "n/a";
		if (a !== b) diffs++;
		console.log(
			`${a === b ? " " : "≠"} ${fmt.padEnd(9)} ${JSON.stringify(s).padEnd(52)} elysia=${a} tb1=${b}`,
		);
	}
}
console.log("diffs:", diffs);
