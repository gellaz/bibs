import {
	Elysia,
	InvalidFileType,
	NotFoundError,
	ValidationError,
} from "elysia";
import {
	InvalidFileTypeError,
	RequestValidationError,
	ResponseValidationError,
	RouteNotFoundError,
	toErrorResponse,
} from "@/http/errors";
import { getLogger } from "@/lib/logger";
import { validationMessage } from "@/lib/validation-message";

// Traduce gli errori propri di Elysia nelle classi di `src/http/errors.ts` e
// lascia la mappatura a `toErrorResponse`, la stessa delle app Hono. Si
// guarda la classe, non `code`: Elysia prende `code` anche dai nostri errori
// (un ServiceError 404 ha `code: "NOT_FOUND"`).
function fromElysia(error: unknown) {
	if (error instanceof ValidationError)
		return error.type === "response"
			? new ResponseValidationError(error.valueError?.path)
			: // Mai `error.message`: è il JSON di Elysia con il body inviato
				// (password comprese) nel campo `found`.
				new RequestValidationError(
					error.type,
					validationMessage(error),
					error.valueError?.path,
					error.valueError?.type,
				);
	if (error instanceof InvalidFileType)
		return new InvalidFileTypeError(error.property);
	if (error instanceof NotFoundError) return new RouteNotFoundError();
	return error;
}

export const errorHandler = new Elysia({ name: "error-handler" }).onError(
	{ as: "global" },
	({ error, status, request, store }) => {
		const result = toErrorResponse(
			fromElysia(error),
			{ method: request.method, path: new URL(request.url).pathname },
			getLogger(store),
		);
		return status(result.status, result.body);
	},
);
