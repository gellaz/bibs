import { describe, expect, it } from "bun:test";
import {
	renderPaymentFailedEmail,
	renderStoreCanceledEmail,
	renderStoreSuspendedEmail,
} from "../src/index";

// react-email 6 wraps JSX interpolations in <!-- --> comment nodes; Intl puts a
// non-breaking space between amount and currency symbol. Normalize both so the
// assertions read like the copy the seller sees.
function normalize(html: string): string {
	return html.replaceAll("<!-- -->", "").replaceAll(" ", " ");
}

describe("renderPaymentFailedEmail", () => {
	it("renders subject, amount, store name and the billing link", async () => {
		const { subject, html } = await renderPaymentFailedEmail({
			ownerName: "Mario Rossi",
			storeName: "Forno Bianchi",
			amountCents: 2900,
			currency: "EUR",
			billingUrl: "https://seller.example.test/billing",
		});
		expect(subject).toBe("Pagamento non riuscito per Forno Bianchi");
		const text = normalize(html);
		expect(text).toContain("Ciao Mario Rossi");
		expect(text).toContain("29,00 €");
		expect(text).toContain("Forno Bianchi");
		expect(text).toContain('href="https://seller.example.test/billing"');
	});

	it("escapes HTML in the store name", async () => {
		const { html } = await renderPaymentFailedEmail({
			ownerName: "Mario",
			storeName: "Forno <b>&</b>",
			amountCents: 100,
			currency: "EUR",
			billingUrl: "https://seller.example.test/billing",
		});
		expect(html).not.toContain("<b>&</b>");
	});
});

describe("renderStoreSuspendedEmail", () => {
	it("says the store is hidden from customers and links to billing", async () => {
		const { subject, html } = await renderStoreSuspendedEmail({
			ownerName: "Mario Rossi",
			storeName: "Forno Bianchi",
			billingUrl: "https://seller.example.test/billing",
		});
		expect(subject).toBe("Forno Bianchi è sospeso su bibs");
		const text = normalize(html);
		expect(text).toContain("non è più visibile ai clienti");
		expect(text).toContain('href="https://seller.example.test/billing"');
	});
});

describe("renderStoreCanceledEmail", () => {
	it("payment_failed: explains the automatic archive and how to reactivate", async () => {
		const { subject, html } = await renderStoreCanceledEmail({
			ownerName: "Mario Rossi",
			storeName: "Forno Bianchi",
			reason: "payment_failed",
			archivedUrl: "https://seller.example.test/store/archived",
		});
		expect(subject).toBe("Forno Bianchi è stato archiviato");
		const text = normalize(html);
		expect(text).toContain("mancato pagamento");
		expect(text).toContain("Riattiva");
		expect(text).toContain('href="https://seller.example.test/store/archived"');
	});

	it("seller_canceled: confirms the seller's choice instead of blaming a payment", async () => {
		const { html } = await renderStoreCanceledEmail({
			ownerName: "Mario Rossi",
			storeName: "Forno Bianchi",
			reason: "seller_canceled",
			archivedUrl: "https://seller.example.test/store/archived",
		});
		const text = normalize(html);
		expect(text).toContain("come hai richiesto");
		expect(text).not.toContain("mancato pagamento");
		expect(text).toContain("Riattiva");
	});
});
