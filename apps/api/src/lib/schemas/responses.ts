import type { TSchema } from "@sinclair/typebox";
import { t } from "elysia";

// ────────────────────────────────────────────
// Response envelope helpers
// ────────────────────────────────────────────

const PaginationSchema = t.Object({
	page: t.Number(),
	limit: t.Number(),
	total: t.Number(),
});

export function okRes<T extends TSchema>(dataSchema: T) {
	return t.Object({
		success: t.Literal(true),
		data: dataSchema,
	});
}

export function okPageRes<T extends TSchema>(itemSchema: T) {
	return t.Object({
		success: t.Literal(true),
		data: t.Array(itemSchema),
		pagination: PaginationSchema,
	});
}

export const OkMessage = t.Object({
	success: t.Literal(true),
	data: t.Null(),
	message: t.String(),
});

// ────────────────────────────────────────────
// Error response schemas (specific per status code)
// ────────────────────────────────────────────

export const BadRequestError = t.Object({
	success: t.Literal(false),
	error: t.Literal("BAD_REQUEST"),
	message: t.String({ description: "Messaggio di errore leggibile" }),
});

export const UnauthorizedError = t.Object({
	success: t.Literal(false),
	error: t.Literal("UNAUTHORIZED"),
	message: t.String({ description: "Messaggio di errore leggibile" }),
});

export const ForbiddenError = t.Object({
	success: t.Literal(false),
	error: t.Literal("FORBIDDEN"),
	message: t.String({ description: "Messaggio di errore leggibile" }),
});

export const NotFoundError = t.Object({
	success: t.Literal(false),
	error: t.Literal("NOT_FOUND"),
	message: t.String({ description: "Messaggio di errore leggibile" }),
});

export const ConflictError = t.Object({
	success: t.Literal(false),
	error: t.Literal("CONFLICT"),
	message: t.String({ description: "Messaggio di errore leggibile" }),
});

export const ValidationError = t.Object({
	success: t.Literal(false),
	error: t.Literal("VALIDATION_ERROR"),
	message: t.String({ description: "Messaggio di errore leggibile" }),
});

export const InternalError = t.Object({
	success: t.Literal(false),
	error: t.Literal("INTERNAL_ERROR"),
	message: t.String({ description: "Messaggio di errore leggibile" }),
});

// Generic error response (for backward compatibility)
export const ErrorResponse = t.Union(
	[
		BadRequestError,
		UnauthorizedError,
		ForbiddenError,
		NotFoundError,
		ConflictError,
		ValidationError,
		InternalError,
	],
	{ description: "Risposta di errore standard" },
);

// Helper to add common error responses with specific types
export function withErrors<T extends Record<number, any>>(
	successResponses: T,
): T & {
	400: typeof BadRequestError;
	401: typeof UnauthorizedError;
	403: typeof ForbiddenError;
	404: typeof NotFoundError;
	422: typeof ValidationError;
	500: typeof InternalError;
} {
	return {
		...successResponses,
		400: BadRequestError,
		401: UnauthorizedError,
		403: ForbiddenError,
		404: NotFoundError,
		422: ValidationError,
		500: InternalError,
	};
}

// Helper to add all error responses including conflict (409)
export function withConflictErrors<T extends Record<number, any>>(
	successResponses: T,
): T & {
	400: typeof BadRequestError;
	401: typeof UnauthorizedError;
	403: typeof ForbiddenError;
	404: typeof NotFoundError;
	409: typeof ConflictError;
	422: typeof ValidationError;
	500: typeof InternalError;
} {
	return {
		...successResponses,
		400: BadRequestError,
		401: UnauthorizedError,
		403: ForbiddenError,
		404: NotFoundError,
		409: ConflictError,
		422: ValidationError,
		500: InternalError,
	};
}
