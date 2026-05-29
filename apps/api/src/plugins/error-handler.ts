import { APIError } from "better-auth";
import { Elysia } from "elysia";
import { apiErrorToServiceError } from "@/lib/auth-errors";
import { PendingVerificationError, ServiceError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { errorBody } from "@/lib/responses";

interface PgError {
	code?: string;
	constraint?: string;
	detail?: string;
}

/**
 * Unwraps a possibly-wrapped error to find the underlying pg DatabaseError.
 * Drizzle wraps query errors in DrizzleQueryError with the original pg error
 * in `.cause`, so we need to dig one level deeper.
 */
function unwrapPgError(error: unknown): PgError {
	if (error instanceof Error && error.cause != null) {
		return error.cause as PgError;
	}
	return error as PgError;
}

export const errorHandler = new Elysia({ name: "error-handler" }).onError(
	{ as: "global" },
	({ code, error, status, request, store }) => {
		const pino = getLogger(store);
		const pathname = new URL(request.url).pathname;
		const { method } = request;

		// better-auth's server-side auth.api.* calls (signInEmail / signUpEmail /
		// sendVerificationEmail) throw an APIError on failure. Normalize it to a
		// ServiceError so it gets the same 4xx envelope instead of falling through
		// to the catch-all 500 below.
		const normalized =
			error instanceof APIError ? apiErrorToServiceError(error) : error;

		if (normalized instanceof ServiceError) {
			const logLevel = normalized.status >= 500 ? "error" : "warn";
			pino[logLevel](
				{
					errorCode: normalized.code,
					errorMessage: normalized.message,
					statusCode: normalized.status,
					path: pathname,
					method,
				},
				`ServiceError: ${normalized.message}`,
			);

			// Le sottoclassi (PendingVerificationError, EmailAlreadyRegisteredError)
			// possono esporre campi extra serializzabili nel body della response.
			const body = errorBody(normalized.code, normalized.message);
			if (normalized instanceof PendingVerificationError) {
				return status(normalized.status, {
					...body,
					resentAt: normalized.resentAt,
				});
			}
			return status(normalized.status, body);
		}

		// Postgres constraint violations → mapped to a precise 4xx instead of 500.
		const pg = unwrapPgError(error);

		// 23505 unique_violation → 409 Conflict
		if (pg.code === "23505") {
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

		// 23503 foreign_key_violation. A blocked delete/update of a still-referenced
		// row is a 409 (resource in use); referencing a non-existent row is a 400
		// (the client sent an invalid id, e.g. a bad municipalityId / addressId).
		if (pg.code === "23503") {
			const stillReferenced =
				pg.detail?.includes("is still referenced") === true;
			pino.warn(
				{
					errorCode: stillReferenced ? "CONFLICT" : "BAD_REQUEST",
					constraint: pg.constraint,
					path: pathname,
					method,
				},
				"Foreign key violation",
			);
			return stillReferenced
				? status(
						409,
						errorBody(
							"CONFLICT",
							"Risorsa ancora in uso: impossibile completare l'operazione",
						),
					)
				: status(400, errorBody("BAD_REQUEST", "Riferimento non valido"));
		}

		// 23514 check_violation → 400 (the submitted data violates a constraint)
		if (pg.code === "23514") {
			pino.warn(
				{
					errorCode: "BAD_REQUEST",
					constraint: pg.constraint,
					path: pathname,
					method,
				},
				"Check constraint violation",
			);
			return status(
				400,
				errorBody("BAD_REQUEST", "Valore non valido per questa operazione"),
			);
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
