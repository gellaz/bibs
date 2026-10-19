// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { SalesSettingsPanel } from "./sales-settings-panel";

const calls = vi.hoisted(() => ({ typesGet: vi.fn(), patch: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	api: () => ({
		seller: {
			stores: () => ({
				patch: calls.patch,
				"order-types": { get: calls.typesGet },
			}),
		},
	}),
}));

// I link verso Orari e Pagamenti vogliono il router: qui basta un'ancora.
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

const originalGetLocale = getLocale;

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
	vi.resetAllMocks();
});

describe("SalesSettingsPanel", () => {
	it("mentre salva i campi non si modificano: la risposta non riscrive ciò che scrivi", async () => {
		overwriteGetLocale(() => "it");
		calls.typesGet.mockResolvedValue({
			data: {
				data: { orderTypes: ["reserve_pickup"], chargesEnabled: false },
			},
			error: null,
		});
		let finish = (_: unknown) => {};
		calls.patch.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const { container } = render(
			<QueryClientProvider client={new QueryClient()}>
				<SalesSettingsPanel
					storeId="s1"
					reservationHours={24}
					lowStockThreshold={5}
					hasOpeningHours={false}
				/>
			</QueryClientProvider>,
		);
		const field = (id: string) =>
			container.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
		await waitFor(() => expect(field("reservation-hours")).toBeTruthy());

		fireEvent.change(field("low-stock-threshold"), { target: { value: "8" } });
		fireEvent.click(screen.getByRole("button", { name: "Salva Modifiche" }));

		await waitFor(() => expect(calls.patch).toHaveBeenCalled());
		expect(field("low-stock-threshold").matches(":disabled")).toBe(true);
		expect(field("reservation-hours").matches(":disabled")).toBe(true);

		finish({
			data: { data: { reservationHours: 24, lowStockThreshold: 8 } },
			error: null,
		});
		await waitFor(() =>
			expect(field("low-stock-threshold").matches(":disabled")).toBe(false),
		);
	});
});
