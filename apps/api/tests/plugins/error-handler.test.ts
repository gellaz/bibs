import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { ServiceError } from "@/lib/errors";
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
		expect(body.message).toBe("Internal server error");
	});

	it("returns 409 for a PostgreSQL unique violation (code 23505)", async () => {
		const res = await app.handle(
			new Request("http://localhost/unique-violation"),
		);
		expect(res.status).toBe(409);
		const body = await json(res);
		expect(body.success).toBe(false);
		expect(body.error).toBe("CONFLICT");
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
