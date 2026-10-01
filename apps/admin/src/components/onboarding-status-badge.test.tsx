// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OnboardingStatusBadge } from "./onboarding-status-badge";

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(cleanup);

describe("OnboardingStatusBadge", () => {
	it("mostra l'etichetta italiana dello stato", () => {
		render(<OnboardingStatusBadge status="pending_review" />);
		expect(screen.getByText("In attesa di revisione")).toBeDefined();
	});

	it("unisce la classe dello stato con quella passata", () => {
		render(<OnboardingStatusBadge status="active" className="ml-2" />);
		const badge = screen.getByText("Attivo");
		expect(badge.className).toContain("text-olive");
		expect(badge.className).toContain("ml-2");
	});

	it("uno stato sconosciuto mostra il valore grezzo invece di sparire", () => {
		render(<OnboardingStatusBadge status="pending_tax" />);
		expect(screen.getByText("pending_tax")).toBeDefined();
	});
});
