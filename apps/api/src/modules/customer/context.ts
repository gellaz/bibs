import type { InferSelectModel } from "drizzle-orm";
import type { customerProfile } from "@/db/schemas/customer";

/**
 * Context injected by the customer guard's `.resolve()` and auth macro.
 * Used as a type assertion in sub-route handlers.
 */
export interface CustomerResolvedContext {
	customerProfile: InferSelectModel<typeof customerProfile>;
	user: {
		id: string;
		name: string;
		email: string;
		role: string | null;
		[key: string]: unknown;
	};
}

/** Type-safe context helper for customer sub-route handlers. */
export function withCustomer<T>(ctx: T) {
	return ctx as T & CustomerResolvedContext;
}
