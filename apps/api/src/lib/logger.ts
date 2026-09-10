import fs from "node:fs";
import path from "node:path";
import type { LogixlysiaStore, LogLevel, Pino, Transport } from "logixlysia";
import pino from "pino";
import { env } from "@/lib/env";

// ── Shared pino options (used by both logixlysia and standalone logger) ──

const LOG_DIR = path.resolve("logs");
fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, "app.log");

/** Base pino options shared across all loggers. */
export const pinoOptions: pino.LoggerOptions = {
	// logixlysia rebuilds its pino from these options and forwards messageKey /
	// errorKey by name, so leaving them out makes pino emit a literal
	// "undefined" key instead of falling back to its own defaults.
	errorKey: "err",
	level: env.NODE_ENV === "production" ? "info" : "debug",
	messageKey: "msg",
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
 * Standalone logger for non-request contexts (cron jobs, startup, timers).
 * Writes to both stdout and the log file.
 */
export const logger = pino(
	pinoOptions,
	pino.multistream([{ stream: process.stdout }, { stream: fileDest }]),
);

/**
 * Type-safe helper to access the Pino logger from the Elysia context store.
 *
 * logixlysia registers its pino instance as `store.pino`, but that state never
 * lands: its pino is a lazily-built Proxy over `{}`, and Elysia's `.state()`
 * silently skips object values with no enumerable keys. The same instance is
 * reachable through `store.logger`, so read it from there as well, and fall
 * back to the standalone logger so that a store without logixlysia (tests,
 * mounted sub-apps) can never take down a handler — least of all the error
 * handler, which would otherwise turn every API error into an opaque 500.
 */
export function getLogger(store: unknown): Pino {
	const logixlysiaStore = store as Partial<LogixlysiaStore> | null | undefined;
	return logixlysiaStore?.pino ?? logixlysiaStore?.logger?.pino ?? logger;
}
