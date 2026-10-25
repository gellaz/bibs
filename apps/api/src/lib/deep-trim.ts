/**
 * Recursively trims all string values in the given value, except under
 * password keys. Preserves File/Blob, Date, and other non-plain objects.
 * Used by the Elysia `normalize` plugin and by the Hono validator (`v()`).
 */
export function deepTrim(value: unknown): unknown {
	if (typeof value === "string") return value.trim();
	if (value === null || value === undefined) return value;
	if (value instanceof Blob || value instanceof Date) return value;
	if (Array.isArray(value)) return value.map(deepTrim);
	if (typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
			// Login goes through better-auth, which this plugin doesn't touch:
			// a password trimmed only at sign-up would no longer match there.
			result[key] = /password/i.test(key) ? val : deepTrim(val);
		}
		return result;
	}
	return value;
}
