import { Elysia } from "elysia";
import { ServiceError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { errorBody } from "@/lib/responses";

/** Checks if an error is a pg unique_violation (code 23505). */
function isUniqueViolation(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as { code: unknown }).code === "23505"
	);
}

export const errorHandler = new Elysia({ name: "error-handler" }).onError(
	{ as: "global" },
	({ code, error, set, request, store }) => {
		const pino = getLogger(store);
		const pathname = new URL(request.url).pathname;
		const { method } = request;

		if (error instanceof ServiceError) {
			set.status = error.status;

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

			return errorBody(error.code, error.message);
		}

		// Postgres unique constraint violation → 409 Conflict
		if (isUniqueViolation(error)) {
			set.status = 409;

			pino.warn(
				{
					errorCode: "CONFLICT",
					constraint: (error as { constraint?: string }).constraint,
					path: pathname,
					method,
				},
				"Unique constraint violation",
			);

			return errorBody(
				"CONFLICT",
				"A record with the same value already exists",
			);
		}

		if (code === "VALIDATION") {
			set.status = 422;

			pino.warn(
				{
					errorCode: "VALIDATION_ERROR",
					errorMessage: error.message,
					path: pathname,
					method,
				},
				"Validation error",
			);

			return errorBody("VALIDATION_ERROR", error.message);
		}

		if (code === "NOT_FOUND") {
			set.status = 404;

			pino.warn(
				{
					errorCode: "NOT_FOUND",
					path: pathname,
					method,
				},
				"Route not found",
			);

			return errorBody("NOT_FOUND", "Route not found");
		}

		set.status = 500;

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

		return errorBody("INTERNAL_ERROR", "Internal server error");
	},
);
