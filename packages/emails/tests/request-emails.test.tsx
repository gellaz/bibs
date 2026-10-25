import { describe, expect, it } from "bun:test";
import {
	renderAdminNewRequestEmail,
	renderSellerChangeOutcomeEmail,
} from "../src/index";

// react-email 6 wraps JSX interpolations in <!-- --> comment nodes.
function normalize(html: string): string {
	return html.replaceAll("<!-- -->", "");
}

describe("renderAdminNewRequestEmail", () => {
	it.each([
		["candidature", "Nuova candidatura venditore su bibs"],
		["vat", "Nuova richiesta di cambio partita IVA"],
		["document", "Nuova richiesta di cambio documento"],
	] as const)("subject for %s", async (kind, expected) => {
		const { subject } = await renderAdminNewRequestEmail({
			kind,
			sellerName: "Mario Rossi",
			requestUrl: "https://admin.example.test/requests",
		});
		expect(subject).toBe(expected);
	});

	it("names the seller and links to the request", async () => {
		const { html } = await renderAdminNewRequestEmail({
			kind: "vat",
			sellerName: "Mario Rossi",
			requestUrl: "https://admin.example.test/requests",
		});
		expect(normalize(html)).toContain("Mario Rossi");
		expect(html).toContain('href="https://admin.example.test/requests"');
	});
});

describe("renderSellerChangeOutcomeEmail", () => {
	it("approved: right subject, no reason", async () => {
		const { subject, html } = await renderSellerChangeOutcomeEmail({
			firstName: "Mario",
			changeType: "vat",
			approved: true,
			reason: null,
		});
		expect(subject).toBe(
			"La tua richiesta di modifica su bibs è stata approvata",
		);
		const text = normalize(html);
		expect(text).toContain("della partita IVA");
		expect(text).not.toContain("Motivo");
		expect(text).toContain("tornano a ricevere ordini");
	});

	it("rejected: shows the reason", async () => {
		const { subject, html } = await renderSellerChangeOutcomeEmail({
			firstName: "Mario",
			changeType: "document",
			approved: false,
			reason: "Numero non valido",
		});
		expect(subject).toBe(
			"La tua richiesta di modifica su bibs non è stata approvata",
		);
		const text = normalize(html);
		expect(text).toContain("del documento d&#x27;identità");
		expect(text).toContain("Motivo: <strong");
		expect(text).toContain("Numero non valido");
		expect(text).not.toContain("tornano a ricevere ordini");
	});

	it("neutral greeting without a first name", async () => {
		const { html } = await renderSellerChangeOutcomeEmail({
			firstName: null,
			changeType: "vat",
			approved: true,
			reason: null,
		});
		expect(normalize(html)).toContain("Ciao,");
	});
});
