// @vitest-environment jsdom
import { LocaleToggle } from "@bibs/ui/custom/locale-toggle";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(cleanup);

describe("LocaleToggle", () => {
	it("renders nothing with a single locale", () => {
		const { container } = render(
			<LocaleToggle
				locales={["it"]}
				value="it"
				onChange={() => {}}
				label="Lingua"
			/>,
		);
		expect(container.innerHTML).toBe("");
	});

	it("renders nothing with no locales", () => {
		const { container } = render(
			<LocaleToggle
				locales={[]}
				value="it"
				onChange={() => {}}
				label="Lingua"
			/>,
		);
		expect(container.innerHTML).toBe("");
	});

	it("shows short codes with native names as accessible labels", () => {
		render(
			<LocaleToggle
				locales={["it", "en"]}
				value="it"
				onChange={() => {}}
				label="Lingua"
			/>,
		);
		expect(screen.getByRole("radiogroup", { name: "Lingua" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Italiano" }).textContent).toBe(
			"IT",
		);
		expect(screen.getByRole("radio", { name: "English" }).textContent).toBe(
			"EN",
		);
	});

	it("calls onChange with the picked locale, not with the current one", () => {
		const onChange = vi.fn();
		render(
			<LocaleToggle
				locales={["it", "en"]}
				value="it"
				onChange={onChange}
				label="Lingua"
			/>,
		);
		fireEvent.click(screen.getByRole("radio", { name: "English" }));
		expect(onChange).toHaveBeenCalledWith("en");
		fireEvent.click(screen.getByRole("radio", { name: "Italiano" }));
		expect(onChange).toHaveBeenCalledTimes(1);
	});
});
