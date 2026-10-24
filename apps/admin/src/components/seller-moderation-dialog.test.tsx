// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import {
	rejectionFromForm,
	SellerModerationDialog,
} from "./seller-moderation-dialog";

const originalGetLocale = getLocale;

afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
});

function renderDialog(
	type: "verify" | "reject",
	isPending = false,
	onConfirm: Parameters<
		typeof SellerModerationDialog
	>[0]["onConfirm"] = () => {},
) {
	render(
		<SellerModerationDialog
			target={{ type, sellerId: "s1", sellerName: "Bottega Rossi" }}
			onOpenChange={() => {}}
			onConfirm={onConfirm}
			isPending={isPending}
		/>,
	);
	return screen.getByRole("alertdialog");
}

describe("SellerModerationDialog", () => {
	it("frase unica con il nome in grassetto", () => {
		overwriteGetLocale(() => "it");
		const dialog = renderDialog("verify");
		expect(dialog.querySelector("strong")?.textContent).toBe("Bottega Rossi");
		expect(screen.getByText(/Sei sicuro di voler approvare/).textContent).toBe(
			"Sei sicuro di voler approvare Bottega Rossi? Il venditore potrà iniziare a operare sulla piattaforma.",
		);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		renderDialog("reject");
		expect(screen.getByText("Reject seller")).toBeDefined();
		expect(
			screen.getByText(/Are you sure you want to reject/).textContent,
		).toBe(
			"Are you sure you want to reject Bottega Rossi? The seller will receive an email with the reason.",
		);
		expect(screen.getByRole("button", { name: "Reject" })).toBeDefined();
	});

	it("mentre la richiesta è in corso il bottone dice di attendere", () => {
		overwriteGetLocale(() => "it");
		renderDialog("verify", true);
		expect(screen.getByRole("button", { name: "Attendere..." })).toBeDefined();
	});
});

describe("rifiuto con motivo", () => {
	it("«Rifiuta» resta disabilitato finché non c'è un motivo", () => {
		overwriteGetLocale(() => "it");
		renderDialog("reject");
		expect(
			(screen.getByRole("button", { name: "Rifiuta" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("con un motivo della lista conferma motivo ed esito", () => {
		overwriteGetLocale(() => "it");
		const onConfirm = vi.fn();
		renderDialog("reject", false, onConfirm);

		fireEvent.change(screen.getByLabelText("Motivo"), {
			target: { value: "0" },
		});
		expect(
			screen.getByText("Il venditore potrà ricaricare il documento"),
		).toBeDefined();
		fireEvent.click(screen.getByRole("button", { name: "Rifiuta" }));

		expect(onConfirm).toHaveBeenCalledWith({
			reason: "Documento illeggibile",
			fixStep: "document",
		});
	});
});

describe("rejectionFromForm", () => {
	it("voce della lista: testo ed esito della voce", () => {
		expect(rejectionFromForm(0, "", null)).toEqual({
			reason: "Documento illeggibile",
			fixStep: "document",
		});
		expect(rejectionFromForm(4, "", null)).toEqual({
			reason: "Attività non ammessa su bibs",
			fixStep: null,
		});
	});

	it("«Altro»: testo ripulito ed esito scelto, null se vuoto", () => {
		expect(rejectionFromForm("other", "   ", null)).toBeNull();
		expect(
			rejectionFromForm("other", " Foto di un'altra persona ", "document"),
		).toEqual({ reason: "Foto di un'altra persona", fixStep: "document" });
	});

	it("nessuna scelta: null", () => {
		expect(rejectionFromForm(null, "x", null)).toBeNull();
	});
});
