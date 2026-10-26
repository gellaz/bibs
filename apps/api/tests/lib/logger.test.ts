import { describe, expect, it } from "bun:test";
import pino from "pino";
import {
	formatDuration,
	formatRequestLine,
} from "@/http/middleware/request-log";
import { pinoOptions } from "@/infra/logger";

describe("pinoOptions", () => {
	it("pins messageKey and errorKey so a derived logger keeps them", () => {
		const lines: string[] = [];
		// A logger rebuilt from these options forwards messageKey/errorKey by
		// name; pino then writes a literal "undefined" key unless we set them,
		// because an explicit `undefined` skips its default.
		const derived = pino(
			{
				...pinoOptions,
				errorKey: pinoOptions.errorKey,
				messageKey: pinoOptions.messageKey,
			},
			{
				write: (line: string) => {
					lines.push(line);
				},
			} as NodeJS.WritableStream,
		);

		derived.info({ action: "test" }, "hello");

		expect(JSON.parse(lines[0] as string)).toMatchObject({
			action: "test",
			msg: "hello",
		});
	});
});

// Le righe colorate dell'API di prima su un terminale (catturate prima di U11
// con `FORCE_COLOR=1` e stdout TTY): stessi codici ANSI, stesso livello. Senza
// colori le confronta `tests/http/app.test.ts` con `golden/app-*.json`.
describe("riga per richiesta su un terminale", () => {
	const captured: [string, string, number, number, string, string][] = [
		[
			"GET",
			"/health",
			200,
			3,
			"info",
			"\u001b[90m2026-10-26T10:56:44.309Z\u001b[39m \u001b[42m\u001b[30mINFO\u001b[39m\u001b[49m \u001b[32m3ms\u001b[39m \u001b[32m\u001b[1mGET\u001b[22m\u001b[39m     \u001b[97m/health\u001b[39m \u001b[32m200\u001b[39m ",
		],
		[
			"OPTIONS",
			"/me/avatar",
			204,
			0.2,
			"info",
			"\u001b[90m2026-10-26T10:56:44.361Z\u001b[39m \u001b[42m\u001b[30mINFO\u001b[39m\u001b[49m \u001b[32m0.20ms\u001b[39m \u001b[36m\u001b[1mOPTIONS\u001b[22m\u001b[39m \u001b[97m/me/avatar\u001b[39m \u001b[32m204\u001b[39m ",
		],
		[
			"DELETE",
			"/me/avatar",
			401,
			6,
			"warn",
			"\u001b[90m2026-10-26T10:56:44.418Z\u001b[39m \u001b[43m\u001b[30mWARNING\u001b[39m\u001b[49m \u001b[32m6ms\u001b[39m \u001b[31m\u001b[1mDELETE\u001b[22m\u001b[39m  \u001b[97m/me/avatar\u001b[39m \u001b[33m401\u001b[39m ",
		],
		[
			"PUT",
			"/me/avatar",
			404,
			0.63,
			"warn",
			"\u001b[90m2026-10-26T10:56:44.470Z\u001b[39m \u001b[43m\u001b[30mWARNING\u001b[39m\u001b[49m \u001b[32m0.63ms\u001b[39m \u001b[33m\u001b[1mPUT\u001b[22m\u001b[39m     \u001b[97m/me/avatar\u001b[39m \u001b[33m404\u001b[39m ",
		],
		[
			"PATCH",
			"/me/avatar",
			404,
			0.5,
			"warn",
			"\u001b[90m2026-10-26T10:56:44.521Z\u001b[39m \u001b[43m\u001b[30mWARNING\u001b[39m\u001b[49m \u001b[32m0.50ms\u001b[39m \u001b[93m\u001b[1mPATCH\u001b[22m\u001b[39m   \u001b[97m/me/avatar\u001b[39m \u001b[33m404\u001b[39m ",
		],
		[
			"HEAD",
			"/health",
			200,
			0.95,
			"info",
			"\u001b[90m2026-10-26T10:56:44.573Z\u001b[39m \u001b[42m\u001b[30mINFO\u001b[39m\u001b[49m \u001b[32m0.95ms\u001b[39m \u001b[92m\u001b[1mHEAD\u001b[22m\u001b[39m    \u001b[97m/health\u001b[39m \u001b[32m200\u001b[39m ",
		],
		[
			"GET",
			"/nope",
			404,
			2,
			"warn",
			"\u001b[90m2026-10-26T10:56:44.627Z\u001b[39m \u001b[43m\u001b[30mWARNING\u001b[39m\u001b[49m \u001b[32m2ms\u001b[39m \u001b[32m\u001b[1mGET\u001b[22m\u001b[39m     \u001b[97m/nope\u001b[39m \u001b[33m404\u001b[39m \n  └─ \u001b[36merror.code\u001b[39m  \u001b[37mNOT_FOUND\u001b[39m",
		],
		[
			"POST",
			"/me/avatar",
			500,
			1,
			"error",
			"\u001b[90m2026-10-26T10:56:44.679Z\u001b[39m \u001b[41m\u001b[30mERROR\u001b[39m\u001b[49m \u001b[32m1ms\u001b[39m \u001b[34m\u001b[1mPOST\u001b[22m\u001b[39m    \u001b[97m/me/avatar\u001b[39m \u001b[31m500\u001b[39m ",
		],
	];
	const SINK = { INFO: "info", WARNING: "warn", ERROR: "error" } as const;
	for (const [method, path, status, durationMs, stream, text] of captured)
		it(`${method} ${path} ${status}`, () => {
			const now = new Date(/\d{4}-\d\d-\d\dT[\d:.]+Z/.exec(text)?.[0] ?? "");
			const { level, line } = formatRequestLine(
				{ method, path, status, durationMs },
				{ now, notFoundAtRoot: path === "/nope", colors: true },
			);
			expect([SINK[level], line]).toEqual([stream, text]);
		});

	it("durata: lenta in giallo, molto lenta in rosso grassetto", () => {
		const line = (durationMs: number) =>
			formatRequestLine(
				{ method: "GET", path: "/x", status: 200, durationMs },
				{ colors: true },
			).line;
		expect(line(600)).toContain("\u001b[33m600ms\u001b[39m");
		expect(line(1500)).toContain("\u001b[31m\u001b[1m1.5s\u001b[22m\u001b[39m");
	});

	it("formato della durata", () => {
		expect(
			[0, 0.004, 0.5, 3.4, 999.6, 1000, 1500, 2000, 9990, 12345].map(
				formatDuration,
			),
		).toEqual([
			"0ms",
			"0.00ms",
			"0.50ms",
			"3ms",
			"1000ms",
			"1s",
			"1.5s",
			"2s",
			"10s",
			"12s",
		]);
	});
});
