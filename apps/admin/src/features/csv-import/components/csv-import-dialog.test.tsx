// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { CsvImportDialog, type CsvImportResult } from "./csv-import-dialog";

const originalGetLocale = getLocale;

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
});

async function importWith(onImport: () => Promise<CsvImportResult>) {
	const onSuccess = vi.fn();
	render(
		<CsvImportDialog
			open
			onOpenChange={() => {}}
			title="Import"
			description="CSV"
			formatHint="hint"
			onImport={onImport}
			onSuccess={onSuccess}
		/>,
	);
	const input = document.querySelector<HTMLInputElement>("#csv-file");
	if (!input) throw new Error("file input missing");
	fireEvent.change(input, {
		target: { files: [new File(["a,b"], "f.csv", { type: "text/csv" })] },
	});
	fireEvent.click(
		screen.getByRole("button", {
			name: getLocale() === "en" ? "Import" : "Importa",
		}),
	);
	return onSuccess;
}

const errors = [{ row: 4, message: "Macro categoria mancante" }];

describe("CsvImportDialog", () => {
	it("reports skipped rows and errors of a category import", async () => {
		const onSuccess = await importWith(async () => ({
			created: 3,
			skipped: 2,
			failed: 1,
			errors,
		}));
		await screen.findByText("Saltate");
		expect(screen.getByText("Create")).toBeTruthy();
		expect(screen.getByText("Errori")).toBeTruthy();
		expect(screen.getByText("Riga")).toBeTruthy();
		expect(screen.getByText("Macro categoria mancante")).toBeTruthy();
		// Successo parziale: la lista sotto si aggiorna comunque.
		expect(onSuccess).toHaveBeenCalledOnce();
	});

	it("reports updated rows of the dictionary import in English", async () => {
		overwriteGetLocale(() => "en");
		await importWith(async () => ({
			created: 0,
			updated: 2,
			failed: 0,
			errors: [],
		}));
		await screen.findByText("Updated");
		expect(screen.getByText("Created")).toBeTruthy();
		// Il «Chiudi» del footer, accanto alla X del dialog.
		expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(2);
	});

	it("falls back to the translated error when the import throws a non-Error", async () => {
		overwriteGetLocale(() => "en");
		await importWith(() => Promise.reject("boom"));
		await waitFor(() =>
			expect(screen.getByText("Error while importing")).toBeTruthy(),
		);
	});
});
