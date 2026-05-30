// Default code per status — usato dal global error handler quando l'errore
// non sovrascrive `code` (per istanze plain di ServiceError).
export const ERROR_CODES = {
	// 4xx Client Errors
	400: "BAD_REQUEST",
	401: "UNAUTHORIZED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	409: "CONFLICT",
	422: "VALIDATION_ERROR",
	429: "TOO_MANY_REQUESTS",
	// 5xx Server Errors
	500: "INTERNAL_ERROR",
	503: "SERVICE_UNAVAILABLE",
} as const;

// Codici extra per status 409 — emessi dalle sottoclassi dedicate
// (EmailAlreadyRegisteredError, PendingVerificationError) e dichiarati
// nello schema ConflictError di apps/api/src/lib/schemas/responses.ts.
export const EXTRA_ERROR_CODES = [
	"EMAIL_ALREADY_REGISTERED",
	"EMAIL_PENDING_VERIFICATION",
] as const;

export type ErrorStatus = keyof typeof ERROR_CODES;
export type ErrorCode =
	| (typeof ERROR_CODES)[ErrorStatus]
	| (typeof EXTRA_ERROR_CODES)[number];

export class ServiceError extends Error {
	public readonly code: ErrorCode;

	constructor(
		public status: ErrorStatus,
		message: string,
	) {
		super(message);
		this.name = "ServiceError";
		this.code = ERROR_CODES[status];
	}
}

/**
 * Errori 409 specializzati per la registrazione. Sopravvivono al global error
 * handler (apps/api/src/plugins/error-handler.ts) che legge `code` dall'istanza
 * se presente, altrimenti fa fallback a ERROR_CODES[status].
 */
export class EmailAlreadyRegisteredError extends ServiceError {
	public readonly code = "EMAIL_ALREADY_REGISTERED" as const;
	constructor(message = "Email già registrata") {
		super(409, message);
		this.name = "EmailAlreadyRegisteredError";
	}
}

export class PendingVerificationError extends ServiceError {
	public readonly code = "EMAIL_PENDING_VERIFICATION" as const;
	constructor(
		public readonly resentAt: string,
		message = "Email già in attesa di verifica. Ti abbiamo rispedito il link.",
	) {
		super(409, message);
		this.name = "PendingVerificationError";
	}
}
