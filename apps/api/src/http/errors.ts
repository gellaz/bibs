import { APIError } from "better-auth";
import { apiErrorToServiceError } from "@/lib/auth-errors";
import { PendingVerificationError, ServiceError } from "@/lib/errors";
import { logger as standaloneLogger } from "@/lib/logger";
import { errorBody } from "@/lib/responses";
import { invalidFileTypeMessage } from "@/lib/validation-message";

// Una sola mappatura errore → risposta (D7 del piano Hono), senza framework:
// la usa l'`onError` delle app Hono (`http/app.ts`). Gli errori di
// validazione arrivano già tradotti nelle classi qui sotto.

/** Input non valido: 422 con il messaggio italiano già costruito. */
export class RequestValidationError extends Error {
	constructor(
		/** Dove: body | query | params | property (decodifica, campo perso). */
		readonly on: string,
		readonly validationMessage: string,
		/** Path del primo errore (`/quantity`), per il log. */
		readonly field?: string,
		/** Tipo di errore (codice dell'issue Zod), per il log. */
		readonly errorType?: unknown,
	) {
		super("Validation error");
	}
}

/** Risposta fuori schema: è un bug nostro, 500. */
export class ResponseValidationError extends Error {
	constructor(readonly field?: string) {
		super("Response validation error");
	}
}

/** File col MIME giusto ma contenuto diverso (controllo sui magic byte). */
export class InvalidFileTypeError extends Error {
	/** `property` come prima di Hono: `body.file`. */
	constructor(readonly property: string) {
		super("Invalid file type");
	}
}

/** Nessuna route per metodo e path. */
export class RouteNotFoundError extends Error {
	constructor() {
		super("Route not found");
	}
}

interface PgError {
	code?: string;
	constraint?: string;
	detail?: string;
}

// Messaggi mirati per i vincoli unique che un utente può toccare dalla UI;
// gli altri ricevono quello generico.
const UNIQUE_MESSAGES: Record<string, string> = {
	product_seller_ean_unique: "Hai già un prodotto con questo EAN",
	holiday_definition_unique_idx: "Esiste già una festività con questa data",
};

/**
 * Drizzle wraps query errors in DrizzleQueryError with the original pg error
 * in `.cause`, so we need to dig one level deeper.
 */
function unwrapPgError(error: unknown): PgError {
	if (error instanceof Error && error.cause != null) {
		return error.cause as PgError;
	}
	return error as PgError;
}

type Log = Pick<typeof standaloneLogger, "warn" | "error">;

export type ErrorResponseBody = ReturnType<typeof errorBody> & {
	resentAt?: string;
};

export function toErrorResponse(
	error: unknown,
	request: { method: string; path: string },
	log: Log = standaloneLogger,
): { status: number; body: ErrorResponseBody } {
	const { method, path } = request;

	// better-auth's server-side auth.api.* calls (signInEmail / signUpEmail /
	// sendVerificationEmail) throw an APIError on failure. Normalize it to a
	// ServiceError so it gets the same 4xx envelope instead of falling through
	// to the catch-all 500 below.
	const normalized =
		error instanceof APIError ? apiErrorToServiceError(error) : error;

	if (normalized instanceof ServiceError) {
		const logLevel = normalized.status >= 500 ? "error" : "warn";
		log[logLevel](
			{
				errorCode: normalized.code,
				errorMessage: normalized.message,
				statusCode: normalized.status,
				path,
				method,
			},
			`ServiceError: ${normalized.message}`,
		);

		// Le sottoclassi (PendingVerificationError, EmailAlreadyRegisteredError)
		// possono esporre campi extra serializzabili nel body della response.
		const body = errorBody(normalized.code, normalized.message);
		if (normalized instanceof PendingVerificationError) {
			return {
				status: normalized.status,
				body: { ...body, resentAt: normalized.resentAt },
			};
		}
		return { status: normalized.status, body };
	}

	// Postgres constraint violations → mapped to a precise 4xx instead of 500.
	const pg = unwrapPgError(error);

	// 23505 unique_violation → 409 Conflict
	if (pg.code === "23505") {
		log.warn(
			{ errorCode: "CONFLICT", constraint: pg.constraint, path, method },
			"Unique constraint violation",
		);
		const message =
			(pg.constraint && UNIQUE_MESSAGES[pg.constraint]) ??
			"Esiste già un elemento con questi dati";
		return { status: 409, body: errorBody("CONFLICT", message) };
	}

	// 23503 foreign_key_violation. A blocked delete/update of a still-referenced
	// row is a 409 (resource in use); referencing a non-existent row is a 400
	// (the client sent an invalid id, e.g. a bad municipalityId / addressId).
	if (pg.code === "23503") {
		const stillReferenced = pg.detail?.includes("is still referenced") === true;
		log.warn(
			{
				errorCode: stillReferenced ? "CONFLICT" : "BAD_REQUEST",
				constraint: pg.constraint,
				path,
				method,
			},
			"Foreign key violation",
		);
		return stillReferenced
			? {
					status: 409,
					body: errorBody(
						"CONFLICT",
						"Risorsa ancora in uso: impossibile completare l'operazione",
					),
				}
			: {
					status: 400,
					body: errorBody("BAD_REQUEST", "Riferimento non valido"),
				};
	}

	// 23514 check_violation → 400 (the submitted data violates a constraint)
	if (pg.code === "23514") {
		log.warn(
			{ errorCode: "BAD_REQUEST", constraint: pg.constraint, path, method },
			"Check constraint violation",
		);
		return {
			status: 400,
			body: errorBody("BAD_REQUEST", "Valore non valido per questa operazione"),
		};
	}

	// Una response fuori schema è un bug nostro, non un input sbagliato.
	if (error instanceof ResponseValidationError) {
		log.error(
			{
				errorCode: "INTERNAL_ERROR",
				on: "response",
				field: error.field,
				path,
				method,
			},
			"Response validation error",
		);
		return {
			status: 500,
			body: errorBody("INTERNAL_ERROR", "Errore interno del server"),
		};
	}

	// Mai il valore inviato nel log: può contenere password.
	if (error instanceof RequestValidationError) {
		log.warn(
			{
				errorCode: "VALIDATION_ERROR",
				on: error.on,
				field: error.field,
				valueErrorType: error.errorType,
				path,
				method,
			},
			"Validation error",
		);
		return {
			status: 422,
			body: errorBody("VALIDATION_ERROR", error.validationMessage),
		};
	}

	if (error instanceof InvalidFileTypeError) {
		log.warn(
			{
				errorCode: "VALIDATION_ERROR",
				on: "body",
				field: error.property,
				path,
				method,
			},
			"Invalid file type",
		);
		return {
			status: 422,
			body: errorBody(
				"VALIDATION_ERROR",
				invalidFileTypeMessage(error.property),
			),
		};
	}

	if (error instanceof RouteNotFoundError) {
		log.warn({ errorCode: "NOT_FOUND", path, method }, "Route not found");
		return {
			status: 404,
			body: errorBody("NOT_FOUND", "Risorsa non trovata"),
		};
	}

	log.error(
		{
			errorCode: "INTERNAL_ERROR",
			errorMessage: error instanceof Error ? error.message : String(error),
			errorStack: error instanceof Error ? error.stack : undefined,
			path,
			method,
		},
		"Unhandled error",
	);
	return {
		status: 500,
		body: errorBody("INTERNAL_ERROR", "Errore interno del server"),
	};
}
