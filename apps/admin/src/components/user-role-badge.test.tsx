// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { UserRoleBadge } from "./user-role-badge";

const originalGetLocale = getLocale;

afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
});

const ROLES = ["admin", "seller", "customer", "employee"];

function labels() {
	return ROLES.map((role) => {
		const { unmount } = render(<UserRoleBadge role={role} />);
		const text = document.body.textContent;
		unmount();
		return text;
	});
}

describe("UserRoleBadge", () => {
	it("etichette italiane dei ruoli", () => {
		overwriteGetLocale(() => "it");
		expect(labels()).toEqual(["Admin", "Venditore", "Cliente", "Dipendente"]);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(labels()).toEqual(["Admin", "Seller", "Customer", "Employee"]);
	});

	it("un ruolo sconosciuto mostra il valore grezzo, nessun ruolo un trattino", () => {
		// Valori in variabile: un letterale in `role` fa scattare la regola ARIA di Biome.
		const unknown: string | null = "moderator";
		const missing: string | null = null;
		render(<UserRoleBadge role={unknown} />);
		expect(screen.getByText("moderator")).toBeDefined();
		cleanup();
		render(<UserRoleBadge role={missing} />);
		expect(screen.getByText("—")).toBeDefined();
	});
});
