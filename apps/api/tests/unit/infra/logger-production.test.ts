import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// In produzione: niente logs/app.log, una riga JSON per richiesta su stdout e
// niente riga di testo. Cartella di lavoro vuota, per vedere se il logger crea
// logs/.
const cwd = process.cwd();
const workdir = mkdtempSync(join(tmpdir(), "bibs-logger-"));
process.chdir(workdir);
afterAll(() => {
	process.chdir(cwd);
	rmSync(workdir, { recursive: true, force: true });
});

mock.module("@/infra/env", () => ({
	env: { ...process.env, NODE_ENV: "production" },
}));
const stdoutWrite = spyOn(process.stdout, "write");
const consoleInfo = spyOn(console, "info");
const { Hono } = await import("hono");
const { requestLog } = await import("@/http/middleware/request-log");

describe("log in produzione", () => {
	it("una riga JSON per richiesta su stdout, senza la riga di testo", async () => {
		const app = new Hono().use(requestLog).get("/x", (c) => c.text("ok"));
		await app.request("http://localhost/x");
		const lines = stdoutWrite.mock.calls
			.map(([chunk]) => String(chunk))
			.filter((line) => line.includes('"type":"request"'));
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] as string)).toMatchObject({
			type: "request",
			method: "GET",
			path: "/x",
			status: 200,
			level: "info",
		});
		expect(consoleInfo).not.toHaveBeenCalled();
	});

	it("non crea logs/", () => {
		expect(existsSync(join(workdir, "logs"))).toBe(false);
	});
});
