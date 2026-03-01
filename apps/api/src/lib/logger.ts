import fs from "node:fs";
import path from "node:path";
import type { LogixlysiaStore } from "logixlysia";
import pino from "pino";
import { env } from "@/lib/env";

// ── Shared pino options (used by both logixlysia and standalone logger) ──

const LOG_DIR = path.resolve("logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, "app.log");

/** Base pino options shared across all loggers. */
export const pinoOptions: pino.LoggerOptions = {
	level: env.NODE_ENV === "production" ? "info" : "debug",
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level: (label) => ({ level: label }),
	},
	redact: ["password", "token", "apiKey", "secret", "authorization"],
};

/**
 * Type-safe helper to access the Pino logger from Elysia context store.
 */
export function getLogger(store: unknown) {
	return (store as LogixlysiaStore).pino;
}

/**
 * Standalone logger for non-request contexts (cron jobs, startup, timers).
 * Writes to both stdout and the log file.
 */
export const logger = pino(
	pinoOptions,
	pino.multistream([
		{ stream: process.stdout },
		{ stream: pino.destination({ dest: LOG_FILE, sync: false }) },
	]),
);
