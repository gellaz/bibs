import { Elysia } from "elysia";
import { PendingVerificationError, ServiceError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { errorBody } from "@/lib/responses";

/**
 * Unwraps a possibly-wrapped error to find the underlying pg DatabaseError.
 * Drizzle wraps query errors in DrizzleQueryError with the original pg error
 * in `.cause`, so we need to dig one level deeper.
 */
function unwrapPgError(error: unknown): { code?: string; constraint?: string } {
	if (error instanceof Error && error.cause != null) {
		return error.cause as { code?: string; constraint?: string };
	}
	return error as { code?: string; constraint?: string };
}

/** Checks if an error is a pg unique_violation (code 23505). */
function isUniqueViolation(error: unknown): boolean {
	const pg = unwrapPgError(error);
	return pg.code === "23505";
}

export const errorHandler = new Elysia({ name: "error-handler" }).onError(
	{ as: "global" },
	({ code, error, status, request, store }) => {
		const pino = getLogger(store);
		const pathname = new URL(request.url).pathname;
		const { method } = request;

		if (error instanceof ServiceError) {
			const logLevel = error.status >= 500 ? "error" : "warn";
			pino[logLevel](
				{
					errorCode: error.code,
					errorMessage: error.message,
					statusCode: error.status,
					path: pathname,
					method,
				},
				`ServiceError: ${error.message}`,
			);

			// Le sottoclassi (PendingVerificationError, EmailAlreadyRegisteredError)
			// possono esporre campi extra serializzabili nel body della response.
			const body = errorBody(error.code, error.message);
			if (error instanceof PendingVerificationError) {
				return status(error.status, { ...body, resentAt: error.resentAt });
			}
			return status(error.status, body);
		}

		// Postgres unique constraint violation → 409 Conflict
		if (isUniqueViolation(error)) {
			const pg = unwrapPgError(error);
			pino.warn(
				{
					errorCode: "CONFLICT",
					constraint: pg.constraint,
					path: pathname,
					method,
				},
				"Unique constraint violation",
			);

			const message =
				pg.constraint === "product_seller_ean_unique"
					? "Hai già un prodotto con questo EAN"
					: "A record with the same value already exists";

			return status(409, errorBody("CONFLICT", message));
		}

		if (code === "VALIDATION") {
			pino.warn(
				{
					errorCode: "VALIDATION_ERROR",
					errorMessage: error.message,
					path: pathname,
					method,
				},
				"Validation error",
			);

			return status(422, errorBody("VALIDATION_ERROR", error.message));
		}

		if (code === "NOT_FOUND") {
			pino.warn(
				{
					errorCode: "NOT_FOUND",
					path: pathname,
					method,
				},
				"Route not found",
			);

			return status(404, errorBody("NOT_FOUND", "Route not found"));
		}

		pino.error(
			{
				errorCode: "INTERNAL_ERROR",
				errorMessage: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
				path: pathname,
				method,
			},
			"Unhandled error",
		);

		return status(500, errorBody("INTERNAL_ERROR", "Internal server error"));
	},
);
