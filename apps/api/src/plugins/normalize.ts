import { Elysia } from "elysia";

/**
 * Recursively trims all string values in the given value.
 * Preserves File/Blob, Date, and other non-plain objects.
 */
function deepTrim(value: unknown): unknown {
	if (typeof value === "string") return value.trim();
	if (value === null || value === undefined) return value;
	if (value instanceof Blob || value instanceof Date) return value;
	if (Array.isArray(value)) return value.map(deepTrim);
	if (typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
			result[key] = deepTrim(val);
		}
		return result;
	}
	return value;
}

/**
 * Global plugin that trims leading/trailing whitespace from all string
 * values in the request body before validation runs.
 *
 * This ensures that `minLength: 1` correctly rejects whitespace-only
 * strings and that stored data is always clean.
 */
export const normalize = new Elysia({ name: "normalize" }).onTransform(
	{ as: "global" },
	(ctx) => {
		if (ctx.body !== undefined && ctx.body !== null) {
			ctx.body = deepTrim(ctx.body);
		}
	},
);
