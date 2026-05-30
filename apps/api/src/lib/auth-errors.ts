import type { APIError } from "better-auth";
import { ERROR_CODES, type ErrorStatus, ServiceError } from "./errors";

/**
 * Mappa i `code` noti di better-auth (quando valorizzati nel body) al nostro
 * status + messaggio. Ha la precedenza sul fallback per-statusCode: serve a
 * distinguere casi che condividono lo stesso 403 (es. utente bannato vs email
 * non verificata), che il solo statusCode non separerebbe.
 */
const MESSAGE_BY_CODE: Record<
	string,
	{ status: ErrorStatus; message: string }
> = {
	EMAIL_NOT_VERIFIED: {
		status: 403,
		message: "Devi verificare la tua email prima di accedere.",
	},
	BANNED_USER: {
		status: 403,
		message: "Account non disponibile. Contatta il supporto.",
	},
	INVALID_EMAIL_OR_PASSWORD: {
		status: 401,
		message: "Email o password non corretti.",
	},
};

/**
 * Fallback per-statusCode quando `body.code` è assente (better-auth a volte lancia
 * con `APIError.from(status, messageString)`, che non valorizza `code`). Nei nostri
 * flussi un 403 da auth.api significa email non verificata e un 401 credenziali errate.
 */
const LOCALIZED_AUTH_MESSAGE: Partial<Record<ErrorStatus, string>> = {
	401: "Email o password non corretti.",
	403: "Devi verificare la tua email prima di accedere.",
};

function isErrorStatus(code: number): code is ErrorStatus {
	return code in ERROR_CODES;
}

function readBodyCode(err: APIError): string | undefined {
	const code = (err.body as { code?: unknown } | undefined)?.code;
	return typeof code === "string" ? code : undefined;
}

function readBodyMessage(err: APIError): string | undefined {
	const body = err.body as { message?: unknown } | undefined;
	return typeof body?.message === "string" && body.message.length > 0
		? body.message
		: undefined;
}

/**
 * Traduce un APIError di better-auth nel nostro ServiceError, così che il global
 * error handler lo serializzi come un 4xx con un messaggio azionabile invece di
 * lasciarlo cadere nel catch-all 500. I dettagli interni dei 5xx non vengono
 * esposti al client.
 */
export function apiErrorToServiceError(err: APIError): ServiceError {
	const code = readBodyCode(err);
	if (code && MESSAGE_BY_CODE[code]) {
		const { status, message } = MESSAGE_BY_CODE[code];
		return new ServiceError(status, message);
	}

	const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;
	const status: ErrorStatus =
		isErrorStatus(statusCode) && statusCode < 500 ? statusCode : 500;

	const message =
		LOCALIZED_AUTH_MESSAGE[status] ??
		(status < 500 ? readBodyMessage(err) : undefined) ??
		"Errore di autenticazione.";

	return new ServiceError(status, message);
}
