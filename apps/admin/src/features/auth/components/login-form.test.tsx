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
import { LoginForm } from "./login-form";

const originalGetLocale = getLocale;

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
});

describe("LoginForm", () => {
	it("mostra etichette ed errori in italiano", async () => {
		render(<LoginForm onSubmit={vi.fn()} />);
		expect(screen.getByLabelText("Email")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Mostra password" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Accedi" }));
		await waitFor(() =>
			expect(screen.getByText("L'email è obbligatoria")).toBeTruthy(),
		);
		expect(screen.getByText("La password è obbligatoria")).toBeTruthy();
	});

	it("segue la lingua corrente", async () => {
		overwriteGetLocale(() => "en");
		render(<LoginForm onSubmit={vi.fn()} apiError="Invalid credentials" />);
		expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
		await waitFor(() =>
			expect(screen.getByText("Email is required")).toBeTruthy(),
		);
		expect(screen.getByText("Password is required")).toBeTruthy();
	});
});
