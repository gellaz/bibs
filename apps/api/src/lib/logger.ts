import fs from "node:fs";
import path from "node:path";
import type { LogixlysiaStore, LogLevel, Transport } from "logixlysia";
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

// ── File transport (fixes missing timestamps in logixlysia file output) ──

const fileDest = pino.destination({ dest: LOG_FILE, sync: false });
const fileLogger = pino(pinoOptions, fileDest);

const LEVEL_MAP: Record<LogLevel, "debug" | "info" | "warn" | "error"> = {
	DEBUG: "debug",
	INFO: "info",
	WARNING: "warn",
	ERROR: "error",
};

/**
 * Custom transport that writes request logs to the log file via pino.
 * logixlysia's built-in file logging uses a hardcoded format without timestamps,
 * so we disable it and route file output through pino instead.
 */
export const fileTransport: Transport = {
	log: (level, message, meta) => {
		const req = meta?.request as { method?: string; url?: string } | undefined;
		const method = req?.method ?? "";
		const pathname = req?.url ? new URL(req.url).pathname : "";
		const beforeTime = meta?.beforeTime as bigint | undefined;
		const durationMs =
			!beforeTime || beforeTime === BigInt(0)
				? 0
				: Number(process.hrtime.bigint() - beforeTime) / 1e6;

		const data = {
			type: "request" as const,
			method,
			path: pathname,
			status: meta?.status != null ? Number(meta.status) : undefined,
			durationMs: Math.round(durationMs * 100) / 100,
		};

		fileLogger[LEVEL_MAP[level] ?? "info"](
			data,
			message || `${method} ${pathname}`,
		);
	},
};

// ── Helpers ─────────────────────────────────────────

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
	pino.multistream([{ stream: process.stdout }, { stream: fileDest }]),
);
