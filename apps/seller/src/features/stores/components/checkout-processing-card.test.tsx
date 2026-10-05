import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { CheckoutProgress } from "@/features/stores/lib/checkout-progress";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { CheckoutProcessingCard } from "./checkout-processing-card";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

function card(kind: CheckoutProgress["kind"], locale: "it" | "en") {
	overwriteGetLocale(() => locale);
	const html = renderToStaticMarkup(
		<CheckoutProcessingCard
			kind={kind}
			onRetry={() => {}}
			onBackToForm={() => {}}
		/>,
	);
	return {
		title: html.match(/data-slot="card-title"[^>]*>([^<]*)</)?.[1],
		body: html.match(/<p[^>]*>([^<]*)<\/p>/)?.[1],
		buttons: [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(
			(match) => match[1],
		),
		spinner: html.includes('role="status"'),
	};
}

describe("CheckoutProcessingCard", () => {
	it("in attesa: spinner e testo, nessun bottone", () => {
		expect(card("waiting", "it")).toEqual({
			title: "Sto creando il tuo negozio…",
			body: "Il pagamento è stato ricevuto. Attendi qualche secondo mentre attiviamo il negozio.",
			buttons: [],
			spinner: true,
		});
	});

	it("in timeout: niente promessa di email, «Controlla di nuovo»", () => {
		expect(card("timeout", "it")).toEqual({
			title: "Sto creando il tuo negozio…",
			body: "L&#x27;attivazione sta richiedendo più del previsto. Il pagamento è registrato, non ripeterlo: il negozio comparirà appena pronto.",
			buttons: ["Controlla di nuovo"],
			spinner: false,
		});
	});

	it("fallito: titolo dedicato e ritorno al form", () => {
		expect(card("failed", "it")).toEqual({
			title: "Pagamento non trovato",
			body: "Non troviamo un pagamento completato per questo negozio. Se hai lasciato Stripe prima della fine, riparti dal form.",
			buttons: ["Torna al form"],
			spinner: false,
		});
	});

	it("segue la lingua corrente", () => {
		expect(card("waiting", "en").title).toBe("Setting up your store…");
		expect(card("timeout", "en").buttons).toEqual(["Check again"]);
		expect(card("failed", "en")).toMatchObject({
			title: "Payment not found",
			buttons: ["Back to the form"],
		});
	});
});
