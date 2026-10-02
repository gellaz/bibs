// @vitest-environment jsdom
import { TabNav } from "@bibs/ui/custom/tab-nav";
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
});
