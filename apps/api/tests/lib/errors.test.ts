import { describe, expect, it } from "bun:test";
import { ServiceError } from "@/lib/errors";

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
