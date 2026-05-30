import { describe, expect, it } from "bun:test";
import { APIError } from "better-auth";
import { apiErrorToServiceError } from "@/lib/auth-errors";
import { ServiceError } from "@/lib/errors";

// better-auth's auth.api.* calls (signInEmail / signUpEmail / sendVerificationEmail)
// throw an APIError on failure. The global error handler must translate it into our
// 4xx envelope instead of letting it fall through to a 500.
describe("apiErrorToServiceError", () => {
	it("maps an unverified-email APIError (403) to a 403 ServiceError with an actionable Italian message", () => {
		const err = new APIError("FORBIDDEN", {
			code: "EMAIL_NOT_VERIFIED",
			message: "Email not verified",
		});

		const se = apiErrorToServiceError(err);

		expect(se).toBeInstanceOf(ServiceError);
		expect(se.status).toBe(403);
		expect(se.code).toBe("FORBIDDEN");
		expect(se.message).toBe("Devi verificare la tua email prima di accedere.");
	});

	it("maps a banned-user APIError (403, code BANNED_USER) to a neutral message, NOT the verify-email message", () => {
		const err = new APIError("FORBIDDEN", {
			code: "BANNED_USER",
			message: "You have been banned from this application",
		});

		const se = apiErrorToServiceError(err);

		expect(se.status).toBe(403);
		expect(se.message).not.toContain("verificare");
		expect(se.message).toBe("Account non disponibile. Contatta il supporto.");
	});

	it("maps an invalid-credentials APIError (401) to a 401 ServiceError with an Italian message", () => {
		const err = new APIError("UNAUTHORIZED", {
			code: "INVALID_EMAIL_OR_PASSWORD",
			message: "Invalid email or password",
		});

		const se = apiErrorToServiceError(err);

		expect(se.status).toBe(401);
		expect(se.code).toBe("UNAUTHORIZED");
		expect(se.message).toBe("Email o password non corretti.");
	});

	it("falls back to the APIError body message for other 4xx without a localized override", () => {
		const err = new APIError("BAD_REQUEST", {
			message: "Indirizzo email non valido",
		});

		const se = apiErrorToServiceError(err);

		expect(se.status).toBe(400);
		expect(se.message).toBe("Indirizzo email non valido");
	});

	it("maps an unknown/5xx statusCode to a 500 ServiceError without leaking the internal message", () => {
		const err = new APIError("INTERNAL_SERVER_ERROR", {
			message: "boom internal detail",
		});

		const se = apiErrorToServiceError(err);

		expect(se.status).toBe(500);
		expect(se.message).not.toBe("boom internal detail");
	});
});
