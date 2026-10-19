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
	it("senza modifiche: niente avviso, Salva disabilitato, non appiccicata", () => {
		const html = render();
		expect(html).not.toContain("Modifiche non salvate");
		expect(html).not.toContain("sticky");
		expect(html).toMatch(/<button[^>]* disabled=""/);
	});

	it("con modifiche: avviso e barra appiccicata in fondo", () => {
		const html = render({ dirty: true });
		expect(html).toContain("Modifiche non salvate");
		expect(html).toContain("sticky");
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
