import { describe, expect, it } from "bun:test";
import { isOriginAllowed } from "@/lib/cors";

describe("isOriginAllowed", () => {
	it("allows any localhost origin outside production", () => {
		expect(
			isOriginAllowed("http://localhost:3001", {
				nodeEnv: "development",
				allowedOrigins: undefined,
			}),
		).toBe(true);
		expect(
			isOriginAllowed("http://localhost", {
				nodeEnv: "test",
				allowedOrigins: undefined,
			}),
		).toBe(true);
	});

	it("does NOT allow localhost in production — only the allow-list applies", () => {
		expect(
			isOriginAllowed("http://localhost:3001", {
				nodeEnv: "production",
				allowedOrigins: "https://bibs.it",
			}),
		).toBe(false);
	});

	it("fails closed for an unrecognised NODE_ENV (e.g. 'staging') — localhost denied", () => {
		expect(
			isOriginAllowed("http://localhost:3001", {
				nodeEnv: "staging",
				allowedOrigins: "https://bibs.it",
			}),
		).toBe(false);
	});

	it("allows an origin present in ALLOWED_ORIGINS regardless of env", () => {
		expect(
			isOriginAllowed("https://admin.bibs.it", {
				nodeEnv: "production",
				allowedOrigins: "https://bibs.it, https://admin.bibs.it",
			}),
		).toBe(true);
	});

	it("rejects an origin not in the allow-list in production", () => {
		expect(
			isOriginAllowed("https://evil.com", {
				nodeEnv: "production",
				allowedOrigins: "https://bibs.it",
			}),
		).toBe(false);
	});

	it("rejects a null/absent origin when nothing matches", () => {
		expect(
			isOriginAllowed(null, {
				nodeEnv: "production",
				allowedOrigins: undefined,
			}),
		).toBe(false);
	});
});
