// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogTitle,
} from "./alert-dialog";

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(cleanup);

function renderOpen(
	onClick?: React.ComponentProps<typeof AlertDialogAction>["onClick"],
) {
	const onOpenChange = vi.fn();
	render(
		<AlertDialog open onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogTitle>Eliminare?</AlertDialogTitle>
				<AlertDialogAction onClick={onClick}>Elimina</AlertDialogAction>
			</AlertDialogContent>
		</AlertDialog>,
	);
	return onOpenChange;
}

// bibs: l'azione chiude il dialog come con Radix (il registry base-nova la
// lascia un Button qualsiasi).
describe("AlertDialogAction", () => {
	it("chiude il dialog al click", () => {
		const onOpenChange = renderOpen();
		fireEvent.click(screen.getByRole("button", { name: "Elimina" }));
		expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
	});

	it("resta aperto se il call-site chiama preventBaseUIHandler", () => {
		const onOpenChange = renderOpen((event) => event.preventBaseUIHandler());
		fireEvent.click(screen.getByRole("button", { name: "Elimina" }));
		expect(onOpenChange).not.toHaveBeenCalled();
	});
});
