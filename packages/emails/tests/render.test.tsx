import { describe, expect, it } from "bun:test";
import {
	renderEmployeeInviteEmail,
	renderVerificationEmail,
} from "../src/index";

describe("renderVerificationEmail", () => {
	it("renders subject and html containing name and verify link", async () => {
		const { subject, html } = await renderVerificationEmail({
			name: "Mario Rossi",
			verifyUrl: "https://example.test/verify?token=abc123",
		});

		expect(subject).toBe("Verifica la tua email su bibs");
		expect(html).toContain("Mario Rossi");
		expect(html).toContain("https://example.test/verify?token=abc123");
	});
});

describe("renderEmployeeInviteEmail", () => {
	it("renders subject and html containing business name, link and expiry", async () => {
		const { subject, html } = await renderEmployeeInviteEmail({
			businessName: "Libreria Esempio",
			inviteUrl: "https://example.test/invite/tok-456",
			expiryDays: 7,
		});

		expect(subject).toBe(
			"Libreria Esempio ti ha invitato a collaborare su bibs",
		);
		expect(html).toContain("Libreria Esempio");
		expect(html).toContain("https://example.test/invite/tok-456");
		expect(html).toContain("7");
	});
});
