// @vitest-environment jsdom
import { TabNav, tabId } from "@bibs/ui/custom/tab-nav";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(cleanup);

// jsdom non ha ResizeObserver (la TabNav lo usa per rimisurare l'indicatore).
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

const TABS = [
	{ value: "all", label: "Tutte" },
	{ value: "pending", label: "In revisione" },
	{ value: "active", label: "Approvate" },
];

function Harness({ initial = "all" }: { initial?: string }) {
	const [tab, setTab] = useState(initial);
	return (
		<TabNav
			tabs={TABS}
			activeTab={tab}
			onTabChange={setTab}
			label="Stato"
			panelId="lista"
		/>
	);
}

describe("TabNav", () => {
	it("tiene nel Tab solo la scheda attiva (roving tabindex)", () => {
		render(<Harness initial="pending" />);
		const tabs = screen.getAllByRole("tab");
		expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
	});

	it("con le frecce sposta il focus e attiva la scheda, ciclando", () => {
		render(<Harness />);
		const [first, , last] = screen.getAllByRole("tab");
		first.focus();

		fireEvent.keyDown(first, { key: "ArrowLeft" });
		expect(document.activeElement).toBe(last);
		expect(last.getAttribute("aria-selected")).toBe("true");

		fireEvent.keyDown(last, { key: "ArrowRight" });
		expect(document.activeElement).toBe(first);
		expect(first.getAttribute("aria-selected")).toBe("true");
	});

	it("Home e End vanno alla prima e all'ultima scheda", () => {
		render(<Harness initial="pending" />);
		const [first, middle, last] = screen.getAllByRole("tab");
		middle.focus();

		fireEvent.keyDown(middle, { key: "End" });
		expect(document.activeElement).toBe(last);
		fireEvent.keyDown(last, { key: "Home" });
		expect(document.activeElement).toBe(first);
	});

	it("dà un nome al tablist e collega le schede al pannello", () => {
		render(<Harness />);
		expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe(
			"Stato",
		);
		for (const tab of screen.getAllByRole("tab")) {
			expect(tab.getAttribute("aria-controls")).toBe("lista");
		}
	});

	it("con panelId ogni scheda ha un id, che il pannello cita in aria-labelledby", () => {
		render(<Harness />);
		const ids = screen.getAllByRole("tab").map((t) => t.id);
		expect(ids).toEqual(TABS.map((t) => tabId("lista", t.value)));
		expect(new Set(ids).size).toBe(TABS.length);
		expect(ids.every(Boolean)).toBe(true);
	});

	it("senza panelId le schede restano senza id", () => {
		render(<TabNav tabs={TABS} activeTab="all" onTabChange={() => {}} />);
		for (const tab of screen.getAllByRole("tab")) expect(tab.id).toBe("");
	});

	it("colora i contatori coi toni di stato", () => {
		render(
			<TabNav
				tabs={[
					{
						value: "review",
						label: "In revisione",
						count: 3,
						badgeColor: "action",
					},
					{
						value: "rejected",
						label: "Rifiutati",
						count: 4,
						badgeColor: "destructive",
					},
				]}
				activeTab="review"
				onTabChange={() => {}}
				label="Stato"
				panelId="lista"
			/>,
		);
		const review = screen.getByText("3");
		expect(review.classList.contains("text-action")).toBe(true);
		expect(review.classList.contains("bg-action/12")).toBe(true);
		expect(screen.getByText("4").classList.contains("bg-destructive/12")).toBe(
			true,
		);
	});
});
