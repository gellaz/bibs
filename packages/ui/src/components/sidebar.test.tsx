import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarProvider, SidebarRail, SidebarTrigger } from "./sidebar";

function render(node: React.ReactElement) {
	return renderToStaticMarkup(<SidebarProvider>{node}</SidebarProvider>);
}

describe("SidebarTrigger", () => {
	it("usa la label passata come testo accessibile", () => {
		const html = render(
			<SidebarTrigger label="Mostra/nascondi barra laterale" />,
		);
		expect(html).toContain(
			'<span class="sr-only">Mostra/nascondi barra laterale</span>',
		);
		expect(html).not.toContain("Toggle Sidebar");
	});

	it("senza label resta il testo del registry", () => {
		expect(render(<SidebarTrigger />)).toContain(
			'<span class="sr-only">Toggle Sidebar</span>',
		);
	});
});

describe("SidebarRail", () => {
	it("usa la label per aria-label e title", () => {
		const html = render(<SidebarRail label="Toggle sidebar" />);
		expect(html).toContain('aria-label="Toggle sidebar"');
		expect(html).toContain('title="Toggle sidebar"');
		expect(html).not.toMatch(/\slabel=/);
	});
});
