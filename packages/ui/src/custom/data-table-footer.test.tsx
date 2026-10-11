import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTableFooter } from "./data-table-footer";

const labels = {
	rowsPerPage: "Righe per pagina",
	pagination: {
		previous: "Pagina precedente",
		next: "Pagina successiva",
		page: (p: number) => `Pagina ${p}`,
	},
};

function html(page: number, total: number) {
	return renderToStaticMarkup(
		<DataTableFooter
			page={page}
			pageSize={20}
			total={total}
			onPageChange={() => {}}
			onPageSizeChange={() => {}}
			rangeLabel={(r) => `${r.start}–${r.end} di ${r.total}`}
			labels={labels}
		/>,
	);
}

describe("DataTableFooter", () => {
	it("range della pagina corrente", () => {
		expect(html(2, 45)).toContain("21–40 di 45");
	});

	it("ultima pagina parziale", () => {
		expect(html(3, 45)).toContain("41–45 di 45");
	});

	it("pagina oltre la fine: range della pagina riportata dentro", () => {
		expect(html(9, 45)).toContain("41–45 di 45");
	});

	it("nessun risultato a pagina 1: niente piede", () => {
		expect(html(1, 0)).toBe("");
	});

	it("nessun risultato oltre pagina 1: il piede resta per riportare la pagina dentro", () => {
		expect(html(4, 0)).not.toBe("");
	});

	it("passa le label a selettore e paginazione", () => {
		const out = html(1, 45);
		expect(out).toContain("Righe per pagina");
		expect(out).toContain("Pagina successiva");
	});
});
