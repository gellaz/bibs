import { describe, expect, it } from "bun:test";
import {
	renderEmployeeInviteEmail,
	renderResetPasswordEmail,
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
		// react-email wraps JSX interpolations in <!-- --> comment nodes; strip
		// them before asserting so the number is contiguous with its surrounding copy.
		const normalized = html.replaceAll("<!-- -->", "");
		expect(normalized).toContain("Il link scade tra 7 giorni.");
	});
});

describe("renderResetPasswordEmail", () => {
	it("renders subject, greeting and reset url", async () => {
		const { subject, html } = await renderResetPasswordEmail({
			name: "Mario Rossi",
			resetUrl:
				"http://localhost:3000/auth/api/reset-password/tok123?callbackURL=http%3A%2F%2Flocalhost%3A3001%2Freset-password",
		});
		expect(subject).toBe("Reimposta la tua password su bibs");
		// react-email 6 inserts <!-- --> comment nodes around interpolations
		const normalized = html.replaceAll("<!-- -->", "");
		expect(normalized).toContain("Ciao Mario Rossi");
		expect(normalized).toContain("/auth/api/reset-password/tok123");
	});

	it("escapes HTML in the name", async () => {
		const { html } = await renderResetPasswordEmail({
			name: "Mario <b>&</b> Rossi",
			resetUrl: "http://localhost:3000/auth/api/reset-password/tok",
		});
		expect(html).toContain("&amp;");
		expect(html).not.toContain("<b>&</b>");
	});
});

describe("renderVerificationEmail — HTML escaping", () => {
	it("escapes special chars in URL and name", async () => {
		const { html } = await renderVerificationEmail({
			name: "Mario <b>Rossi</b>",
			verifyUrl: "https://example.test/verify?a=1&b=2",
		});

		// & in the href must be entity-encoded
		expect(html).toContain("&amp;");
		// raw HTML tag in name must NOT appear unescaped
		expect(html).not.toContain("<b>Rossi</b>");
	});
});
