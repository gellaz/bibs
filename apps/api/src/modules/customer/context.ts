/**
 * `detail` OpenAPI delle route del cliente con `requireCustomer` (prima di
 * Hono dal `.guard` del modulo): la sessione better-auth.
 */
export const customerSecurity = {
	security: [{ bearerAuth: [] }],
};
