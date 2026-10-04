import { describe, expect, it } from "bun:test";
import { APIError } from "better-auth";
import { Elysia, t } from "elysia";
import logixlysia from "logixlysia";
import { ServiceError } from "@/lib/errors";
import { pinoOptions } from "@/lib/logger";
import { errorHandler } from "@/plugins/error-handler";
import { requestId } from "@/plugins/request-id";

// Provides store.pino, which logixlysia normally injects in production.
const noopPino = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	fatal: () => {},
	trace: () => {},
} as any;

const app = new Elysia()
	.state("pino", noopPino)
	.use(errorHandler)
	.use(requestId)
	.get("/service-error-404", () => {
		throw new ServiceError(404, "Resource not found");
	})
	.get("/service-error-403", () => {
		throw new ServiceError(403, "Access denied");
	})
	.get("/service-error-400", () => {
		throw new ServiceError(400, "Bad input");
	})
	.get("/service-error-500", () => {
		throw new ServiceError(500, "Something broke");
	})
	.get("/unhandled", () => {
		throw new Error("Unexpected crash");
	})
	.get("/unique-violation", () => {
		const err = Object.assign(new Error("duplicate key value"), {
			code: "23505",
			constraint: "users_email_unique",
		});
		throw err;
	})
	.get("/unique-violation-holiday", () => {
		throw Object.assign(new Error("duplicate key value"), {
			code: "23505",
			constraint: "holiday_definition_unique_idx",
		});
	})
	.get("/fk-missing", () => {
		// INSERT/UPDATE referencing a row that does not exist → client sent a bad id.
		throw Object.assign(
			new Error("insert or update violates foreign key constraint"),
			{
				code: "23503",
				constraint: "customer_addresses_municipality_id_fk",
				detail:
					'Key (municipality_id)=(nope) is not present in table "municipalities".',
			},
		);
	})
	.get("/fk-referenced", () => {
		// DELETE/UPDATE of a parent still referenced by children (onDelete restrict).
		throw Object.assign(
			new Error("update or delete violates foreign key constraint"),
			{
				code: "23503",
				constraint: "provinces_region_id_fk",
				detail: 'Key (id)=(r1) is still referenced from table "provinces".',
			},
		);
	})
	.get("/fk-wrapped", () => {
		// Mirrors Drizzle wrapping the pg error in DrizzleQueryError.cause.
		const pg = Object.assign(new Error("fk"), {
			code: "23503",
			detail:
				'Key (shipping_address_id)=(x) is not present in table "customer_addresses".',
		});
		throw Object.assign(new Error("Failed query"), { cause: pg });
	})
	.get("/check-violation", () => {
		throw Object.assign(new Error("new row violates check constraint"), {
			code: "23514",
			constraint: "customer_points_non_negative",
		});
	})
	.get("/api-error-unverified", () => {
		// better-auth signInEmail throws this when requireEmailVerification is on.
		throw new APIError("FORBIDDEN", {
			code: "EMAIL_NOT_VERIFIED",
			message: "Email not verified",
		});
	})
	.get("/api-error-bad-credentials", () => {
		throw new APIError("UNAUTHORIZED", {
			code: "INVALID_EMAIL_OR_PASSWORD",
			message: "Invalid email or password",
		});
	})
	.get("/api-error-internal", () => {
		throw new APIError("INTERNAL_SERVER_ERROR", {
			message: "leaky internal detail",
		});
	})
	.get("/ok", () => ({ success: true, data: "ok" }));

async function json(res: Response) {
	return res.json() as Promise<Record<string, unknown>>;
}

describe("errorHandler — ServiceError", () => {
	it("returns 404 for ServiceError(404)", async () => {
		const res = await app.handle(
			new Request("http://localhost/service-error-404"),
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("NOT_FOUND");
		expect(body.message).toBe("Resource not found");
	});

	it("returns 403 for ServiceError(403)", async () => {
		const res = await app.handle(
			new Request("http://localhost/service-error-403"),
		);
		expect(res.status).toBe(403);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("FORBIDDEN");
		expect(body.message).toBe("Access denied");
	});

	it("returns 400 for ServiceError(400)", async () => {
		const res = await app.handle(
			new Request("http://localhost/service-error-400"),
		);
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error).toBe("BAD_REQUEST");
	});

	it("returns 500 for ServiceError(500)", async () => {
		const res = await app.handle(
			new Request("http://localhost/service-error-500"),
		);
		expect(res.status).toBe(500);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("INTERNAL_ERROR");
	});
});

describe("errorHandler — unhandled errors", () => {
	it("returns 500 for an unhandled Error", async () => {
		const res = await app.handle(new Request("http://localhost/unhandled"));
		expect(res.status).toBe(500);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("INTERNAL_ERROR");
		expect(body.message).toBe("Errore interno del server");
	});

	it("returns 409 for a PostgreSQL unique violation (code 23505)", async () => {
		const res = await app.handle(
			new Request("http://localhost/unique-violation"),
		);
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("CONFLICT");
		expect(body.message).toBe("Esiste già un elemento con questi dati");
	});

	it("uses a targeted message for a known unique constraint", async () => {
		const res = await app.handle(
			new Request("http://localhost/unique-violation-holiday"),
		);
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.message).toBe("Esiste già una festività con questa data");
	});
});

describe("errorHandler — pg constraint violations", () => {
	it("maps a foreign key violation on a missing reference to 400", async () => {
		const res = await app.handle(new Request("http://localhost/fk-missing"));
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("BAD_REQUEST");
	});

	it("maps a foreign key violation on a still-referenced row to 409", async () => {
		const res = await app.handle(new Request("http://localhost/fk-referenced"));
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.error).toBe("CONFLICT");
	});

	it("unwraps a DrizzleQueryError-wrapped FK violation (400)", async () => {
		const res = await app.handle(new Request("http://localhost/fk-wrapped"));
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error).toBe("BAD_REQUEST");
	});

	it("maps a check constraint violation to 400", async () => {
		const res = await app.handle(
			new Request("http://localhost/check-violation"),
		);
		expect(res.status).toBe(400);
		const body = await json(res);
		expect(body.error).toBe("BAD_REQUEST");
	});
});

describe("errorHandler — better-auth APIError", () => {
	it("maps an unverified-email APIError to 403 with an actionable message (not 500)", async () => {
		const res = await app.handle(
			new Request("http://localhost/api-error-unverified"),
		);
		expect(res.status).toBe(403);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("FORBIDDEN");
		expect(body.message).toBe(
			"Devi verificare la tua email prima di accedere.",
		);
	});

	it("maps an invalid-credentials APIError to 401 (not 500)", async () => {
		const res = await app.handle(
			new Request("http://localhost/api-error-bad-credentials"),
		);
		expect(res.status).toBe(401);
		const body = await json(res);
		expect(body.error).toBe("UNAUTHORIZED");
		expect(body.message).toBe("Email o password non corretti.");
	});

	it("maps a 5xx APIError to 500 without leaking the internal message", async () => {
		const res = await app.handle(
			new Request("http://localhost/api-error-internal"),
		);
		expect(res.status).toBe(500);
		const body = await json(res);
		expect(body.error).toBe("INTERNAL_ERROR");
		expect(body.message).not.toBe("leaky internal detail");
	});
});

describe("errorHandler — validation errors", () => {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const capturingPino = {
		...noopPino,
		warn: (...args: unknown[]) => warnings.push(args),
		error: (...args: unknown[]) => errors.push(args),
	};
	const validating = new Elysia()
		.state("pino", capturingPino)
		.use(errorHandler)
		.post("/cart", () => ({ success: true }), {
			body: t.Object({
				password: t.String(),
				quantity: t.Integer({ minimum: 1 }),
			}),
		})
		.get("/bad-response", () => ({ count: "nope" }) as never, {
			response: { 200: t.Object({ count: t.Integer() }) },
		})
		.post("/upload", () => ({ success: true }), {
			body: t.Object({ file: t.File({ type: "image/*" }) }),
		});

	const postCart = (body: unknown) =>
		validating.handle(
			new Request("http://localhost/cart", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);

	it("returns 422 with an Italian field + rule message", async () => {
		const res = await postCart({ password: "segreta123", quantity: 0 });

		expect(res.status).toBe(422);
		expect(await json(res)).toEqual({
			success: false,
			error: "VALIDATION_ERROR",
			message: "Quantità: deve essere almeno 1",
		});
	});

	it("logs where the error is, never the submitted values", async () => {
		warnings.length = 0;
		await postCart({ password: "segreta123", quantity: 0 });

		expect(warnings).toHaveLength(1);
		expect(JSON.stringify(warnings[0])).not.toContain("segreta123");
		expect(warnings[0][0]).toMatchObject({
			errorCode: "VALIDATION_ERROR",
			on: "body",
			field: "/quantity",
		});
	});

	it("treats an invalid response as a 500 bug, not a 422", async () => {
		errors.length = 0;
		const res = await validating.handle(
			new Request("http://localhost/bad-response"),
		);

		expect(res.status).toBe(500);
		expect(await json(res)).toMatchObject({ error: "INTERNAL_ERROR" });
		expect(errors).toHaveLength(1);
	});

	it("returns 422 for a file of the wrong type", async () => {
		const form = new FormData();
		form.append("file", new File(["hello"], "a.txt", { type: "text/plain" }));
		const res = await validating.handle(
			new Request("http://localhost/upload", { method: "POST", body: form }),
		);

		expect(res.status).toBe(422);
		expect(await json(res)).toEqual({
			success: false,
			error: "VALIDATION_ERROR",
			message: "File: tipo di file non ammesso",
		});
	});

	it("returns 422 for a file whose content does not match its type", async () => {
		const form = new FormData();
		form.append("file", new File(["hello"], "a.png", { type: "image/png" }));
		const res = await validating.handle(
			new Request("http://localhost/upload", { method: "POST", body: form }),
		);

		expect(res.status).toBe(422);
		expect(await json(res)).toEqual({
			success: false,
			error: "VALIDATION_ERROR",
			message: "File: tipo di file non ammesso",
		});
	});
});

describe("errorHandler — route not found", () => {
	it("returns 404 with NOT_FOUND for an unknown route", async () => {
		const res = await app.handle(
			new Request("http://localhost/does-not-exist"),
		);
		expect(res.status).toBe(404);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("NOT_FOUND");
	});
});

describe("errorHandler — response structure", () => {
	it("error responses have success, error, and message fields", async () => {
		const res = await app.handle(
			new Request("http://localhost/service-error-404"),
		);
		const body = await json(res);
		expect(body).toHaveProperty("success", false);
		expect(body).toHaveProperty("error");
		expect(body).toHaveProperty("message");
	});

	it("success responses are passed through unchanged", async () => {
		const res = await app.handle(new Request("http://localhost/ok"));
		expect(res.status).toBe(200);
		const body = await json(res);
		expect(body.success).toBe(true);
	});

	it("sets X-Request-Id header on error responses", async () => {
		const res = await app.handle(
			new Request("http://localhost/service-error-404"),
		);
		expect(res.headers.get("x-request-id")).toBeString();
	});
});

// Regression: the app above stubs `store.pino` by hand. Mounted the way
// src/index.ts mounts it — on top of the real logixlysia plugin — the handler
// used to crash while logging, turning every API error into an opaque 500.
describe("errorHandler — mounted on the real logixlysia plugin", () => {
	const logged = new Elysia()
		.use(
			logixlysia({
				config: {
					showStartupMessage: false,
					disableFileLogging: true,
					pino: pinoOptions,
				},
			}),
		)
		.use(errorHandler)
		.get("/unhandled", () => {
			throw new Error("Unexpected crash");
		})
		.get("/service-error-404", () => {
			throw new ServiceError(404, "Resource not found");
		});

	it("returns the JSON envelope for an unhandled error", async () => {
		const res = await logged.handle(new Request("http://localhost/unhandled"));

		expect(res.status).toBe(500);
		expect(await json(res)).toMatchObject({
			success: false,
			error: "INTERNAL_ERROR",
		});
	});

	it("returns the JSON envelope for a ServiceError", async () => {
		const res = await logged.handle(
			new Request("http://localhost/service-error-404"),
		);

		expect(res.status).toBe(404);
		expect(await json(res)).toMatchObject({
			success: false,
			error: "NOT_FOUND",
		});
	});

	it("returns the JSON envelope for an unknown route", async () => {
		const res = await logged.handle(new Request("http://localhost/nope"));

		expect(res.status).toBe(404);
		expect(await json(res)).toMatchObject({
			success: false,
			error: "NOT_FOUND",
		});
	});
});
