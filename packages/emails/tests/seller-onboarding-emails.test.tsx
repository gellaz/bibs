import { describe, expect, it } from "bun:test";
import {
	renderSellerApplicationReceivedEmail,
	renderSellerApprovedEmail,
	renderSellerRejectedEmail,
} from "../src/index";

// react-email 6 wraps JSX interpolations in <!-- --> comment nodes.
function normalize(html: string): string {
	return html.replaceAll("<!-- -->", "");
}

describe("renderSellerApplicationReceivedEmail", () => {
	it("greets by first name and says the application is under review", async () => {
		const { subject, html } = await renderSellerApplicationReceivedEmail({
			firstName: "Mario",
		});
		expect(subject).toBe("Abbiamo ricevuto la tua candidatura su bibs");
		expect(normalize(html)).toContain("Ciao Mario,");
	});

	it("falls back to a neutral greeting without a first name", async () => {
		const { html } = await renderSellerApplicationReceivedEmail({
			firstName: null,
		});
		expect(normalize(html)).toContain("Ciao,");
	});
});

describe("renderSellerApprovedEmail", () => {
	it("links to the seller app", async () => {
		const { subject, html } = await renderSellerApprovedEmail({
			firstName: "Mario",
			sellerUrl: "https://seller.example.test/",
		});
		expect(subject).toBe("Il tuo account venditore su bibs è attivo");
		expect(html).toContain('href="https://seller.example.test/"');
	});
});

describe("renderSellerRejectedEmail", () => {
	it("definitive: reason and support link, no fix link", async () => {
		const { subject, html } = await renderSellerRejectedEmail({
			firstName: "Mario",
			reason: "Attività non ammessa su bibs",
			fix: null,
			supportEmail: "supporto@bibs.it",
		});
		expect(subject).toBe("La tua candidatura su bibs non è stata approvata");
		const text = normalize(html);
		expect(text).toContain("Attività non ammessa su bibs");
		expect(text).toContain('href="mailto:supporto@bibs.it"');
		expect(text).not.toContain("Correggi e reinvia");
	});

	it("keeps the line breaks of a reason written on several lines", async () => {
		const { html } = await renderSellerRejectedEmail({
			firstName: "Mario",
			reason: "Foto sfocata.\nRifalla con più luce.",
			fix: null,
			supportEmail: "supporto@bibs.it",
		});
		const text = normalize(html);
		expect(text).toContain("Foto sfocata.\nRifalla con più luce.");
		expect(text).toContain("white-space:pre-line");
	});

	it("document fix: asks to upload the document again and links to the step", async () => {
		const { subject, html } = await renderSellerRejectedEmail({
			firstName: "Mario",
			reason: "Documento illeggibile",
			fix: {
				step: "document",
				url: "https://seller.example.test/onboarding/document",
			},
			supportEmail: "supporto@bibs.it",
		});
		expect(subject).toBe("La tua candidatura su bibs va corretta");
		const text = normalize(html);
		expect(text).toContain("Carica di nuovo il documento");
		expect(text).toContain(
			'href="https://seller.example.test/onboarding/document"',
		);
		expect(text).toContain('href="mailto:supporto@bibs.it"');
	});

	it("escapes HTML in a hand-written reason", async () => {
		const { html } = await renderSellerRejectedEmail({
			firstName: "Mario",
			reason: '<a href="https://x.test">clicca</a>',
			fix: null,
			supportEmail: "supporto@bibs.it",
		});
		expect(html).not.toContain('<a href="https://x.test">');
	});
});
