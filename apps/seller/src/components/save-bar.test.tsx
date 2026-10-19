import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { SaveBar } from "./save-bar";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

function render(props: Partial<Parameters<typeof SaveBar>[0]> = {}) {
	overwriteGetLocale(() => "it");
	return renderToStaticMarkup(
		<SaveBar
			dirty={false}
			pending={false}
			submitLabel="Salva"
			pendingLabel="Salvataggio…"
			{...props}
		/>,
	);
}

describe("SaveBar", () => {
	it("sempre in fondo: appiccicata mentre si scorre, spinta in basso se la pagina è corta", () => {
		for (const dirty of [false, true]) {
			const html = render({ dirty });
			expect(html).toContain("sticky");
			expect(html).toContain("bottom-0");
			expect(html).toContain("mt-auto");
		}
	});

	it("a riposo come la barra laterale, azzurra «tocca a te» con modifiche", () => {
		expect(render()).toContain("bg-sidebar");
		const dirty = render({ dirty: true });
		// Opaca: la barra è fissata e il contenuto le scorre sotto.
		expect(dirty).toContain("var(--action)_12%,var(--background)");
		expect(dirty).not.toContain("bg-action/12");
		expect(dirty).toContain("border-action/40");
		expect(dirty).not.toContain("bg-sidebar");
	});

	it("senza modifiche: niente avviso e Salva disabilitato", () => {
		const html = render();
		expect(html).not.toContain("Modifiche non salvate");
		expect(html).toMatch(/<button[^>]* disabled=""/);
	});

	it("con modifiche: avviso e Salva attivo", () => {
		const html = render({ dirty: true });
		expect(html).toContain("Modifiche non salvate");
		expect(html).not.toMatch(/<button[^>]* disabled=""/);
	});

	it("disabled tiene spento il Salva anche con modifiche", () => {
		expect(render({ dirty: true, disabled: true })).toMatch(
			/<button[^>]* disabled=""/,
		);
	});

	it("submit del form senza onSave, bottone semplice con onSave", () => {
		expect(render({ dirty: true })).toContain('type="submit"');
		expect(render({ dirty: true, onSave: () => {} })).toContain(
			'type="button"',
		);
	});
});
