// Standard error codes per status HTTP
export const ERROR_CODES = {
	// 4xx Client Errors
	400: "BAD_REQUEST",
	401: "UNAUTHORIZED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	409: "CONFLICT",
	422: "VALIDATION_ERROR",
	// 5xx Server Errors
	500: "INTERNAL_ERROR",
	503: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorStatus = keyof typeof ERROR_CODES;
export type ErrorCode = (typeof ERROR_CODES)[ErrorStatus];

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
