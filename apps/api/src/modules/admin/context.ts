/**
 * Context injected by the admin guard's `.resolve()` and auth macro.
 * Used as a type assertion in sub-route handlers.
 */
export interface AdminResolvedContext {
	user: {
		id: string;
		name: string;
		email: string;
		role: string | null;
		[key: string]: unknown;
	};
}

/** Type-safe context helper for admin sub-route handlers. */
export function withAdmin<T>(ctx: T) {
	return ctx as T & AdminResolvedContext;
}

/**
 * `detail` OpenAPI delle route admin su Hono: il tag e la security che le
 * route Elysia prendono dal modulo (`tags` e `.guard` di `index.ts`).
 */
export const adminDetail = (summary: string, description: string) => ({
	summary,
	description,
	tags: ["Admin"],
	security: [{ bearerAuth: [] }],
});
