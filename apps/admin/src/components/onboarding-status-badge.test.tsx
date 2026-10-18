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
		const badge = screen
			.getByText("Attivo")
			.closest<HTMLElement>("[data-tone]");
		expect(badge?.dataset.tone).toBe("success");
		expect(badge?.className).toContain("ml-2");
	});

	it("mostra il passo negli stati in corso", () => {
		overwriteGetLocale(() => "it");
		render(<OnboardingStatusBadge status="pending_document" />);
		expect(screen.getByText("3/6")).toBeDefined();
		expect(screen.getByText("Passo 3 di 6").classList.contains("sr-only")).toBe(
			true,
		);
	});

	it("gli stati finali non mostrano il passo", () => {
		overwriteGetLocale(() => "it");
		const { container } = render(
			<>
				<OnboardingStatusBadge status="active" />
				<OnboardingStatusBadge status="rejected" />
			</>,
		);
		expect(container.textContent).not.toContain("/6");
	});

	it("uno stato sconosciuto mostra il valore grezzo invece di sparire", () => {
		render(<OnboardingStatusBadge status="pending_tax" />);
		const badge = screen
			.getByText("pending_tax")
			.closest<HTMLElement>("[data-tone]");
		expect(badge?.dataset.tone).toBe("closed");
	});
});
