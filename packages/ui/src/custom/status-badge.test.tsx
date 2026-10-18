// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { PackageIcon } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(cleanup);

const badgeOf = (text: string) =>
	screen.getByText(text).closest<HTMLElement>("[data-tone]");

describe("StatusBadge", () => {
	it("mostra etichetta e tono", () => {
		render(
			<StatusBadge tone="action" icon={PackageIcon}>
				Da preparare
			</StatusBadge>,
		);
		const badge = badgeOf("Da preparare");
		expect(badge?.dataset.tone).toBe("action");
		for (const cls of [
			"text-action",
			"bg-action/12",
			"border-action/40",
			"whitespace-nowrap",
		])
			expect(badge?.classList.contains(cls)).toBe(true);
	});

	it("il tono chiuso non ha fondo", () => {
		render(
			<StatusBadge tone="closed" icon={PackageIcon}>
				Completato
			</StatusBadge>,
		);
		const badge = badgeOf("Completato");
		expect(badge?.classList.contains("text-muted-foreground")).toBe(true);
		expect(badge?.classList.contains("border-border")).toBe(true);
		expect([...(badge?.classList ?? [])].some((c) => c.startsWith("bg-"))).toBe(
			false,
		);
	});

	it("l'icona è decorativa", () => {
		render(
			<StatusBadge tone="success" icon={PackageIcon}>
				Attivo
			</StatusBadge>,
		);
		expect(
			badgeOf("Attivo")?.querySelector("svg")?.getAttribute("aria-hidden"),
		).toBe("true");
	});

	it("mostra il passo", () => {
		render(
			<StatusBadge
				tone="waiting"
				icon={PackageIcon}
				step={{ current: 3, total: 6, label: "Passo 3 di 6" }}
			>
				Documento mancante
			</StatusBadge>,
		);
		expect(screen.getByText("3/6").getAttribute("aria-hidden")).toBe("true");
		expect(screen.getByText("Passo 3 di 6").classList.contains("sr-only")).toBe(
			true,
		);
	});

	it("unisce la classe passata", () => {
		render(
			<StatusBadge tone="destructive" icon={PackageIcon} className="ml-2">
				Rifiutato
			</StatusBadge>,
		);
		expect(badgeOf("Rifiutato")?.classList.contains("ml-2")).toBe(true);
	});
});
