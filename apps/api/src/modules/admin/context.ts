/**
 * `detail` OpenAPI delle route admin su Hono: il tag e la security che le
 * route Elysia prendevano dal modulo (`tags` e `.guard` dell'`adminModule`).
 */
export const adminDetail = (summary: string, description: string) => ({
	summary,
	description,
	tags: ["Admin"],
	security: [{ bearerAuth: [] }],
});
