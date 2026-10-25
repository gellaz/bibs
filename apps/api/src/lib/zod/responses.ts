import { z } from "zod";
import { zFormat } from "./t";

// Gemelli Zod di `lib/schemas/responses.ts` (D3 del piano Hono), nello stesso
// ordine e con gli stessi nomi: inviluppi di successo e risposte di errore
// per status, che finiscono in /openapi.

const PaginationSchema = z.object({
	page: z.number(),
	limit: z.number(),
	total: z.number(),
});

export function okRes<T extends z.ZodType>(dataSchema: T) {
	return z.object({
		success: z.literal(true),
		data: dataSchema,
	});
}

export function okPageRes<T extends z.ZodType>(itemSchema: T) {
	return z.object({
		success: z.literal(true),
		data: z.array(itemSchema),
		pagination: PaginationSchema,
	});
}

export const OkMessage = z.object({
	success: z.literal(true),
	data: z.null(),
	message: z.string(),
});

// ────────────────────────────────────────────
// Error response schemas (specific per status code)
// ────────────────────────────────────────────

const message = z
	.string()
	.meta({ description: "Messaggio di errore leggibile" });

const errorOf = <C extends string>(code: C) =>
	z.object({
		success: z.literal(false),
		error: z.literal(code),
		message,
	});

export const BadRequestError = errorOf("BAD_REQUEST");
export const UnauthorizedError = errorOf("UNAUTHORIZED");
export const ForbiddenError = errorOf("FORBIDDEN");
export const NotFoundError = errorOf("NOT_FOUND");

export const ConflictError = z.object({
	success: z.literal(false),
	error: z
		.enum([
			"CONFLICT",
			"EMAIL_ALREADY_REGISTERED",
			"EMAIL_PENDING_VERIFICATION",
		])
		.meta({ description: "Discriminator dell'errore 409 specifico" }),
	message,
	// Presente solo quando error === "EMAIL_PENDING_VERIFICATION".
	resentAt: z.optional(
		zFormat("date-time").meta({
			description:
				"ISO timestamp dell'invio del link di verifica appena rispedito",
		}),
	),
});

export const ValidationError = errorOf("VALIDATION_ERROR");
export const TooManyRequestsError = errorOf("TOO_MANY_REQUESTS");
export const ServiceUnavailableError = errorOf("SERVICE_UNAVAILABLE");
export const InternalError = errorOf("INTERNAL_ERROR");

/** Corpo di ogni errore dell'API (`errorBody` in `lib/responses.ts`). */
export interface ErrorBody {
	success: false;
	error: string;
	message: string;
	resentAt?: string;
}

export function withErrors<T extends Record<number, z.ZodType>>(
	successResponses: T,
) {
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

export function withConflictErrors<T extends Record<number, z.ZodType>>(
	successResponses: T,
) {
	return {
		...withErrors(successResponses),
		409: ConflictError,
	};
}
