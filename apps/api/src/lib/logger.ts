import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { env } from "@/lib/env";

// ── Shared pino options (standalone logger and request file log) ──

const LOG_DIR = path.resolve("logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, "app.log");

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

// ── Request log file (one pino JSON line per request, with its timestamp) ──

const fileDest = pino.destination({ dest: LOG_FILE, sync: false });
const fileLogger = pino(pinoOptions, fileDest);

export interface RequestLogEntry {
	method: string;
	path: string;
	status: number;
	durationMs: number;
}

/** The request line in `logs/app.log`, written by `http/middleware/request-log.ts`. */
export function logRequestToFile(
	level: "info" | "warn" | "error",
	{ method, path, status, durationMs }: RequestLogEntry,
) {
	fileLogger[level](
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

// ── Helpers ─────────────────────────────────────────

/**
 * Standalone logger for every context (handlers, cron jobs, startup, timers).
 * Writes to both stdout and the log file.
 */
export const logger = pino(
	pinoOptions,
	pino.multistream([{ stream: process.stdout }, { stream: fileDest }]),
);
