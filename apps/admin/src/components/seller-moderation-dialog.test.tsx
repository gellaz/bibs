// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { SellerModerationDialog } from "./seller-moderation-dialog";

const originalGetLocale = getLocale;

afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
});

function renderDialog(type: "verify" | "reject", isPending = false) {
	render(
		<SellerModerationDialog
			target={{ type, sellerId: "s1", sellerName: "Bottega Rossi" }}
			onOpenChange={() => {}}
			onConfirm={() => {}}
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
			"Are you sure you want to reject Bottega Rossi? The seller will need to update their details and resubmit the application.",
		);
		expect(screen.getByRole("button", { name: "Reject" })).toBeDefined();
	});

	it("mentre la richiesta è in corso il bottone dice di attendere", () => {
		overwriteGetLocale(() => "it");
		renderDialog("verify", true);
		expect(screen.getByRole("button", { name: "Attendere..." })).toBeDefined();
	});
});
