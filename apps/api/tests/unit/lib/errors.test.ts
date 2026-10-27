import { describe, expect, it } from "bun:test";
import { isUniqueViolation, ServiceError } from "@/lib/errors";

describe("ServiceError", () => {
	it("is an instance of Error", () => {
		const err = new ServiceError(404, "Not found");
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(ServiceError);
	});

	it("sets the message", () => {
		const err = new ServiceError(400, "Invalid input");
		expect(err.message).toBe("Invalid input");
	});

	it("sets name to ServiceError", () => {
		const err = new ServiceError(500, "Internal");
		expect(err.name).toBe("ServiceError");
	});

	it.each([
		[400, "BAD_REQUEST"],
		[401, "UNAUTHORIZED"],
		[403, "FORBIDDEN"],
		[404, "NOT_FOUND"],
		[409, "CONFLICT"],
		[422, "VALIDATION_ERROR"],
		[500, "INTERNAL_ERROR"],
		[503, "SERVICE_UNAVAILABLE"],
	] as const)("status %i maps to code %s", (status, code) => {
		const err = new ServiceError(status, "test");
		expect(err.status).toBe(status);
		expect(err.code).toBe(code);
	});
});

describe("isUniqueViolation", () => {
	it("detects a top-level pg 23505 code", () => {
		expect(isUniqueViolation({ code: "23505" })).toBe(true);
	});

	it("detects 23505 nested in the error cause chain (drizzle wrapping)", () => {
		const wrapped = Object.assign(new Error("query failed"), {
			cause: Object.assign(new Error("pg error"), { code: "23505" }),
		});
		expect(isUniqueViolation(wrapped)).toBe(true);
	});

	it("returns false for a different pg code (e.g. 23503 FK)", () => {
		expect(isUniqueViolation({ code: "23503" })).toBe(false);
	});

	it("returns false for a ServiceError or a plain error", () => {
		expect(isUniqueViolation(new ServiceError(409, "conflict"))).toBe(false);
		expect(isUniqueViolation(new Error("boom"))).toBe(false);
		expect(isUniqueViolation(null)).toBe(false);
		expect(isUniqueViolation(undefined)).toBe(false);
	});

	it("stops walking the cause chain past a small fixed depth", () => {
		// 23505 buried 5 levels deep (beyond the depth-4 walk) is not detected.
		const deep = {
			cause: { cause: { cause: { cause: { cause: { code: "23505" } } } } },
		};
		expect(isUniqueViolation(deep)).toBe(false);
	});
});
