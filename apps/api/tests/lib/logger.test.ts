import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import logixlysia from "logixlysia";
import pino from "pino";
import { getLogger, pinoOptions } from "@/lib/logger";

// logixlysia is the only thing that populates the Elysia store with a logger,
// so the contract has to be checked against the real plugin: a hand-rolled
// `.state("pino", …)` stub would keep passing even when the plugin stops
// providing it (which is exactly how this broke in production).
const app = new Elysia()
	.use(
		logixlysia({
			config: {
				showStartupMessage: false,
				disableFileLogging: true,
				pino: pinoOptions,
			},
		}),
	)
	.get("/log", ({ store }) => {
		const pino = getLogger(store);
		pino.info({ action: "test" }, "logged from a route");
		return {
			info: typeof pino.info,
			warn: typeof pino.warn,
			error: typeof pino.error,
		};
	});

describe("getLogger", () => {
	it("returns a usable logger from a store populated by logixlysia", async () => {
		const res = await app.handle(new Request("http://localhost/log"));

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			info: "function",
			warn: "function",
			error: "function",
		});
	});

	it("falls back to the standalone logger when the store has no logger", () => {
		const pino = getLogger({});

		expect(typeof pino.info).toBe("function");
		expect(typeof pino.error).toBe("function");
	});
});

describe("pinoOptions", () => {
	it("pins messageKey and errorKey so logixlysia's derived logger keeps them", () => {
		const lines: string[] = [];
		// logixlysia rebuilds its own pino from these options and forwards
		// messageKey/errorKey by name; pino then writes a literal "undefined"
		// key unless we set them, because an explicit `undefined` skips its
		// default.
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
