// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { OnboardingStatusBadge } from "./onboarding-status-badge";

const originalGetLocale = getLocale;

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
});

describe("OnboardingStatusBadge", () => {
	it("mostra l'etichetta italiana dello stato", () => {
		overwriteGetLocale(() => "it");
		render(<OnboardingStatusBadge status="pending_review" />);
		expect(screen.getByText("In attesa di revisione")).toBeDefined();
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		render(<OnboardingStatusBadge status="pending_review" />);
		expect(screen.getByText("Awaiting review")).toBeDefined();
	});

	it("unisce la classe dello stato con quella passata", () => {
		overwriteGetLocale(() => "it");
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
