import { createMiddleware } from "hono/factory";
import { logRequestToFile } from "@/lib/logger";

// La riga per richiesta di prima della migrazione (il plugin di log 6.10.3 con
// `customLogFormat: "{now} {level} {duration} {method} {pathname} {status}
// {ip}"`, `{ip}` vuoto), stessi testi e stessi colori: su console.info,
// console.warn o console.error secondo lo status, colorata solo su un
// terminale. Più la riga JSON in `logs/app.log`. Attesi in
// `tests/http/golden/app-*.json` e `tests/lib/logger.test.ts`. Formato e colori
// del plugin di prima (MIT): `THIRD_PARTY_NOTICES.md`.

type Level = "INFO" | "WARNING" | "ERROR";

const useColors =
	process.stdout.isTTY === true &&
	!("NO_COLOR" in process.env) &&
	process.env.FORCE_COLOR !== "0" &&
	process.env.TERM !== "dumb";

/** Testo tra i codici ANSI di apertura e chiusura, nell'ordine dato. */
const ansi = (text: string, ...codes: [number, number][]) =>
	codes.reduceRight(
		(t, [open, close]) => `\x1b[${open}m${t}\x1b[${close}m`,
		text,
	);

const FG = 39;
const BOLD: [number, number] = [1, 22];
const fg = (code: number): [number, number] => [code, FG];
const bg = (code: number): [number, number] => [code, 49];

const LEVEL_BG: Record<Level, number> = { INFO: 42, WARNING: 43, ERROR: 41 };
const METHOD_FG: Record<string, number> = {
	GET: 32,
	POST: 34,
	PUT: 33,
	PATCH: 93,
	DELETE: 31,
	OPTIONS: 36,
	HEAD: 92,
	TRACE: 35,
	CONNECT: 96,
};

export function formatDuration(ms: number): string {
	if (ms >= 1000) {
		const s = ms / 1000;
		if (s >= 10) return `${Math.round(s)}s`;
		const fixed = s.toFixed(1);
		return fixed.endsWith(".0") ? `${Math.round(s)}s` : `${fixed}s`;
	}
	if (ms > 0 && ms < 1) return `${ms.toFixed(2)}ms`;
	return `${Math.round(ms)}ms`;
}

const statusFg = (status: number) =>
	status >= 500
		? 31
		: status >= 400
			? 33
			: status >= 300
				? 36
				: status >= 200
					? 32
					: 90;

const levelOf = (status: number): Level =>
	status >= 500 ? "ERROR" : status >= 400 ? "WARNING" : "INFO";

/** La riga di console, come la scriveva il plugin di log di prima. */
export function formatRequestLine(
	{
		method,
		path,
		status,
		durationMs,
	}: {
		method: string;
		path: string;
		status: number;
		durationMs: number;
	},
	{
		now = new Date(),
		notFoundAtRoot = false,
		colors = useColors,
	}: { now?: Date; notFoundAtRoot?: boolean; colors?: boolean } = {},
): { level: Level; line: string } {
	const paint = colors ? ansi : (text: string) => text;
	const level = levelOf(status);
	const verb = method.toUpperCase();
	const duration = formatDuration(durationMs);
	const line = [
		paint(now.toISOString(), fg(90)),
		paint(level, bg(LEVEL_BG[level]), fg(30)),
		durationMs < 500
			? paint(duration, fg(32))
			: durationMs < 1000
				? paint(duration, fg(33))
				: paint(duration, fg(31), BOLD),
		paint(verb, fg(METHOD_FG[verb] ?? 37), BOLD) +
			" ".repeat(Math.max(0, 7 - verb.length)),
		paint(path, fg(97)),
		paint(String(status), fg(statusFg(status))),
		"",
	].join(" ");
	// Il 404 di una richiesta che nessuna route prende portava l'albero col codice.
	const tree = notFoundAtRoot
		? `\n  └─ ${paint("error.code", fg(36))}  ${paint("NOT_FOUND", fg(37))}`
		: "";
	return { level, line: line + tree };
}

/** console.info/warn/error e il livello pino del file. */
const SINK = { INFO: "info", WARNING: "warn", ERROR: "error" } as const;

// Le richieste che il 404 dell'app radice ha preso (`src/app.ts`).
const rootNotFound = new WeakSet<Request>();
export const markRootNotFound = (request: Request) => rootNotFound.add(request);

/** Il primo middleware dell'app radice: misura e scrive la riga a risposta pronta. */
export const requestLog = createMiddleware(async (c, next) => {
	const start = performance.now();
	await next();
	const entry = {
		method: c.req.method,
		// Un URL che non si analizza (Host non valido) non deve far perdere la riga.
		path: URL.canParse(c.req.url) ? new URL(c.req.url).pathname : c.req.path,
		status: c.res.status,
		durationMs: performance.now() - start,
	};
	const { level, line } = formatRequestLine(entry, {
		notFoundAtRoot: rootNotFound.has(c.req.raw),
	});
	console[SINK[level]](line);
	logRequestToFile(SINK[level], entry);
});
