// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchInput } from "./search-input";

beforeEach(() => {
	vi.useFakeTimers();
});

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function setup(initial = "") {
	const onValueChange = vi.fn();
	const view = (value: string) => (
		<SearchInput
			value={value}
			onValueChange={onValueChange}
			aria-label="Cerca"
			clearLabel="Cancella ricerca"
		/>
	);
	const { rerender } = render(view(initial));
	const input = screen.getByRole("textbox", {
		name: "Cerca",
	}) as HTMLInputElement;
	return { onValueChange, input, setValue: (v: string) => rerender(view(v)) };
}

describe("SearchInput", () => {
	it("conferma una volta sola, dopo 300 ms di quiete", () => {
		const { onValueChange, input } = setup();
		fireEvent.change(input, { target: { value: "a" } });
		fireEvent.change(input, { target: { value: "ab" } });
		act(() => vi.advanceTimersByTime(299));
		expect(onValueChange).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(1));
		expect(onValueChange).toHaveBeenCalledTimes(1);
		expect(onValueChange).toHaveBeenCalledWith("ab");
	});

	it("un valore che cambia da fuori (back/forward) vince su un tasto in attesa", () => {
		const { onValueChange, input, setValue } = setup("abc");
		fireEvent.change(input, { target: { value: "abcd" } });
		setValue("");
		act(() => vi.advanceTimersByTime(1000));
		expect(onValueChange).not.toHaveBeenCalled();
		expect(input.value).toBe("");
	});

	it("scrivere e cancellare dentro il debounce non conferma nulla", () => {
		const { onValueChange, input } = setup();
		fireEvent.change(input, { target: { value: "ab" } });
		fireEvent.change(input, { target: { value: "" } });
		act(() => vi.advanceTimersByTime(1000));
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it("«cancella» svuota e conferma subito", () => {
		const { onValueChange, input } = setup("abc");
		fireEvent.click(screen.getByRole("button", { name: "Cancella ricerca" }));
		expect(onValueChange).toHaveBeenCalledTimes(1);
		expect(onValueChange).toHaveBeenCalledWith("");
		expect(input.value).toBe("");
	});

	it("senza testo non mostra «cancella»", () => {
		setup();
		expect(
			screen.queryByRole("button", { name: "Cancella ricerca" }),
		).toBeNull();
	});
});
