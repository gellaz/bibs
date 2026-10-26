/**
 * `detail` OpenAPI delle route del cliente con `requireCustomer` (oggi dal
 * `.guard` del modulo Elysia): la sessione better-auth.
 */
export const customerSecurity = {
	security: [{ bearerAuth: [] }],
};
