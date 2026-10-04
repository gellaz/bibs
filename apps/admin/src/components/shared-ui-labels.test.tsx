// @vitest-environment jsdom
import { Calendar } from "@bibs/ui/components/calendar";
import { CopyButton } from "@bibs/ui/custom/copy-button";
import { DataPagination } from "@bibs/ui/custom/data-pagination";
import { DataTable } from "@bibs/ui/custom/data-table";
import { PageSizeSelector } from "@bibs/ui/custom/page-size-selector";
import { TableColumnsToggle } from "@bibs/ui/custom/table-columns-toggle";
import { dayPickerLocale } from "@bibs/ui/lib/day-picker-locale";
import { intlLocaleFor, setIntlLocaleResolver } from "@bibs/ui/lib/intl-locale";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	dataPaginationLabels,
	tableColumnsToggleLabels,
} from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";

const originalGetLocale = getLocale;

// DataTable misura il contenitore; jsdom non ha ResizeObserver.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
	setIntlLocaleResolver(() => "it-IT");
});

function useEnglish() {
	overwriteGetLocale(() => "en");
	setIntlLocaleResolver(() => intlLocaleFor("en"));
}

describe("DataPagination", () => {
	it("keeps the Italian labels by default", () => {
		render(<DataPagination page={2} totalPages={3} onPageChange={() => {}} />);
		expect(screen.getByLabelText("Pagina precedente")).toBeTruthy();
		expect(screen.getByLabelText("Pagina successiva")).toBeTruthy();
		expect(screen.getByLabelText("Pagina 3")).toBeTruthy();
	});

	it("uses the labels of the current language", () => {
		useEnglish();
		render(
			<DataPagination
				page={2}
				totalPages={3}
				onPageChange={() => {}}
				labels={dataPaginationLabels()}
			/>,
		);
		expect(screen.getByLabelText("Previous page")).toBeTruthy();
		expect(screen.getByLabelText("Next page")).toBeTruthy();
		expect(screen.getByLabelText("Page 3").getAttribute("aria-current")).toBe(
			null,
		);
		expect(screen.getByLabelText("Page 2").getAttribute("aria-current")).toBe(
			"page",
		);
	});
});

describe("TableColumnsToggle", () => {
	type Row = { name: string };
	const columns = (labels?: ReturnType<typeof tableColumnsToggleLabels>) =>
		[
			{ accessorKey: "name", header: "Nome" },
			{
				id: "actions",
				header: ({ table }) => (
					<TableColumnsToggle table={table} labels={labels} />
				),
			},
		] satisfies DataTableColumnDef<Row>[];

	it("keeps the Italian trigger label by default", () => {
		render(<DataTable data={[{ name: "a" }]} columns={columns()} />);
		expect(screen.getByLabelText("Colonne visibili")).toBeTruthy();
	});

	it("uses the labels of the current language", () => {
		useEnglish();
		render(
			<DataTable
				data={[{ name: "a" }]}
				columns={columns(tableColumnsToggleLabels())}
			/>,
		);
		expect(screen.getByLabelText("Visible columns")).toBeTruthy();
		expect(tableColumnsToggleLabels()).toEqual({
			trigger: "Visible columns",
			menuTitle: "Columns",
			reset: "Reset to default",
			locked: "Always visible",
		});
	});
});

describe("PageSizeSelector", () => {
	it("shows the label it is given", () => {
		useEnglish();
		render(
			<PageSizeSelector
				pageSize={20}
				onPageSizeChange={() => {}}
				label={m.common_rows_per_page()}
			/>,
		);
		expect(screen.getByText("Rows per page")).toBeTruthy();
	});
});

describe("CopyButton", () => {
	it("switches to the copied label after a successful copy", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});
		render(
			<CopyButton value="123" labels={{ copy: "Copy ID", copied: "Copied" }} />,
		);
		await act(async () => {
			fireEvent.click(screen.getByLabelText("Copy ID"));
		});
		expect(writeText).toHaveBeenCalledWith("123");
		expect(screen.getByLabelText("Copied")).toBeTruthy();
	});

	it("keeps the Italian labels by default", () => {
		render(<CopyButton value="123" />);
		expect(screen.getByLabelText("Copia")).toBeTruthy();
	});
});

describe("dayPickerLocale", () => {
	const month = new Date(2026, 9, 1);

	it("follows the current language", () => {
		expect(dayPickerLocale().code).toBe("it");
		useEnglish();
		expect(dayPickerLocale().code).toBe("en-GB");
	});

	it("renders the Calendar in Italian, weeks starting on Monday", () => {
		const { container } = render(
			<Calendar locale={dayPickerLocale()} month={month} />,
		);
		expect(screen.getByText("ottobre 2026")).toBeTruthy();
		expect(screen.getByLabelText("Vai al mese successivo")).toBeTruthy();
		const firstWeekday = container.querySelector(".rdp-weekday");
		expect(firstWeekday?.getAttribute("aria-label")).toBe("lunedì");
	});

	it("renders the Calendar in English", () => {
		useEnglish();
		render(<Calendar locale={dayPickerLocale()} month={month} />);
		expect(screen.getByText("October 2026")).toBeTruthy();
		expect(screen.getByLabelText("Go to the Next Month")).toBeTruthy();
	});
});
