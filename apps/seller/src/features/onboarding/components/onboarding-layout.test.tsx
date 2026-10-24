// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { OnboardingLayout } from "./onboarding-layout";

const state = vi.hoisted(() => ({ rejectionReason: null as string | null }));

vi.mock("@/hooks/use-onboarding", () => ({
	useOnboardingStatus: () => ({
		data: { rejectionReason: state.rejectionReason },
	}),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const originalGetLocale = getLocale;

afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
	state.rejectionReason = null;
});

function renderLayout() {
	overwriteGetLocale(() => "it");
	render(
		<OnboardingLayout
			currentStatus="pending_document"
			title="Documento"
			description="Carica il documento"
		>
			<div />
		</OnboardingLayout>,
	);
}

describe("OnboardingLayout", () => {
	it("dopo un rifiuto correggibile mostra il motivo in cima", () => {
		state.rejectionReason = "Documento illeggibile";
		renderLayout();
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("Candidatura da correggere");
		expect(alert.textContent).toContain("Documento illeggibile");
	});

	it("senza rifiuto niente avviso", () => {
		renderLayout();
		expect(screen.queryByRole("alert")).toBeNull();
	});
});
