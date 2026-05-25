import { describe, expect, it } from "bun:test";
import { decideExistingUser } from "@/modules/registration/services";

const NOW = Date.parse("2026-05-25T12:00:00.000Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function userRow(
	overrides: Partial<{ createdAt: Date; emailVerified: boolean }> = {},
) {
	return {
		id: "user-1",
		name: "Test",
		email: "test@example.it",
		emailVerified: false,
		image: null,
		createdAt: new Date(NOW - 1000),
		updatedAt: new Date(NOW),
		role: null,
		banned: null,
		banReason: null,
		banExpires: null,
		firstName: null,
		lastName: null,
		birthDate: null,
		...overrides,
	} as unknown as Parameters<typeof decideExistingUser>[0];
}

describe("decideExistingUser", () => {
	it("returns 'none' when row is null/undefined", () => {
		expect(decideExistingUser(null, NOW).kind).toBe("none");
		expect(decideExistingUser(undefined, NOW).kind).toBe("none");
	});

	it("returns 'verified-conflict' when emailVerified=true", () => {
		const row = userRow({ emailVerified: true });
		const decision = decideExistingUser(row, NOW);
		expect(decision.kind).toBe("verified-conflict");
	});

	it("returns 'pending-resend' when emailVerified=false and createdAt within 7gg", () => {
		const row = userRow({
			createdAt: new Date(NOW - SEVEN_DAYS_MS + 60_000),
		});
		const decision = decideExistingUser(row, NOW);
		expect(decision.kind).toBe("pending-resend");
	});

	it("boundary: returns 'pending-resend' at exactly 7gg - 1ms (window is exclusive on the upper end)", () => {
		const row = userRow({ createdAt: new Date(NOW - SEVEN_DAYS_MS + 1) });
		expect(decideExistingUser(row, NOW).kind).toBe("pending-resend");
	});

	it("boundary: returns 'pending-expired' at exactly 7gg (the window is `age < PENDING_TTL_MS`)", () => {
		const row = userRow({ createdAt: new Date(NOW - SEVEN_DAYS_MS) });
		expect(decideExistingUser(row, NOW).kind).toBe("pending-expired");
	});

	it("returns 'pending-expired' when older than 7gg", () => {
		const row = userRow({
			createdAt: new Date(NOW - 10 * 24 * 60 * 60 * 1000),
		});
		const decision = decideExistingUser(row, NOW);
		expect(decision.kind).toBe("pending-expired");
	});
});
