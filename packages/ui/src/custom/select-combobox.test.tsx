// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupOptions, SelectCombobox } from "./select-combobox";

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(cleanup);

const options = [
	{ value: "a", label: "Smartphone", group: "Elettronica" },
	{ value: "b", label: "Caffè", group: "Alimentari" },
	{ value: "c", label: "Tablet", group: "Elettronica" },
];

const common = {
	options,
	placeholder: "Scegli",
	emptyText: "Niente",
	clearLabel: (name: string) => `Rimuovi ${name}`,
	"aria-label": "Categoria",
	onChange: () => {},
};

describe("groupOptions", () => {
	it("raggruppa nell'ordine di arrivo", () => {
		expect(groupOptions(options)).toEqual([
			{ value: "Elettronica", items: [options[0], options[2]] },
			{ value: "Alimentari", items: [options[1]] },
		]);
	});

	it("senza gruppi lascia l'elenco piatto", () => {
		const flat = [{ value: "x", label: "X" }];
		expect(groupOptions(flat)).toBe(flat);
	});
});

describe("SelectCombobox", () => {
	it("singola: mostra l'etichetta scelta e il pulsante per toglierla", () => {
		render(<SelectCombobox {...common} value="b" />);
		expect(
			(screen.getByRole("combobox", { name: "Categoria" }) as HTMLInputElement)
				.value,
		).toBe("Caffè");
		expect(screen.getByRole("button", { name: "Rimuovi Caffè" })).toBeTruthy();
	});

	it("multipla: un chip per ogni scelta, nell'ordine del valore", () => {
		render(<SelectCombobox {...common} multiple value={["c", "a"]} />);
		const removes = screen.getAllByRole("button", { name: /^Rimuovi / });
		expect(removes.map((b) => b.getAttribute("aria-label"))).toEqual([
			"Rimuovi Tablet",
			"Rimuovi Smartphone",
		]);
	});

	it("Escape a tendina chiusa non svuota la scelta", () => {
		const onChange = vi.fn();
		render(<SelectCombobox {...common} value="b" onChange={onChange} />);
		const input = screen.getByRole("combobox", {
			name: "Categoria",
		}) as HTMLInputElement;
		input.focus();
		fireEvent.keyDown(input, { key: "Escape" });
		expect(onChange).not.toHaveBeenCalled();
		expect(input.value).toBe("Caffè");
	});
});
