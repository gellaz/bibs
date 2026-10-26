import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { env } from "@/infra/env";

// ── Shared pino options (standalone logger and request file log) ──

/** Base pino options shared across all loggers. */
export const pinoOptions: pino.LoggerOptions = {
	// Pinned explicitly: a logger rebuilt from these options with
	// `messageKey: undefined` would emit a literal "undefined" key instead of
	// falling back to pino's defaults.
	errorKey: "err",
	level: env.NODE_ENV === "production" ? "info" : "debug",
	messageKey: "msg",
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level: (label) => ({ level: label }),
	},
	redact: ["password", "token", "apiKey", "secret", "authorization"],
};

// ── Destinations ────────────────────────────────────

/**
 * Outside production every log also goes to `logs/app.log` (single file, no
 * rotation). In production the platform collects stdout: no file, no `logs/`.
 */
function openLogFile() {
	const dir = path.resolve("logs");
	fs.mkdirSync(dir, { recursive: true });
	return pino.destination({ dest: path.join(dir, "app.log"), sync: false });
}
const fileDest = env.NODE_ENV === "production" ? undefined : openLogFile();

/**
 * Standalone logger for every context (handlers, cron jobs, startup, timers):
 * stdout, plus the log file outside production.
 */
export const logger = pino(
	pinoOptions,
	fileDest
		? pino.multistream([{ stream: process.stdout }, { stream: fileDest }])
		: process.stdout,
);

// ── Request log (one pino JSON line per request, with its timestamp) ──

// Only in the file outside production (stdout has the coloured line of
// `http/middleware/request-log.ts`); on stdout in production.
const requestLogger = fileDest ? pino(pinoOptions, fileDest) : logger;

export interface RequestLogEntry {
	method: string;
	path: string;
	status: number;
	durationMs: number;
}

/** The JSON request line, written by `http/middleware/request-log.ts`. */
export function logRequest(
	level: "info" | "warn" | "error",
	{ method, path, status, durationMs }: RequestLogEntry,
) {
	requestLogger[level](
		{
			type: "request" as const,
			method,
			path,
			status,
			durationMs: Math.round(durationMs * 100) / 100,
		},
		`${method} ${path}`,
	);
}
