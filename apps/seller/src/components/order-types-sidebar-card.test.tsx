// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { OrderTypesSidebarCard } from "./order-types-sidebar-card";

type OrderType = "reserve_pickup" | "pay_pickup";

const state = vi.hoisted(() => ({
	storeId: "s1" as string | null,
	owner: true,
	types: {} as Record<
		string,
		{ orderTypes: OrderType[]; offered: OrderType[] }
	>,
}));

vi.mock("@/hooks/use-active-store", () => ({
	useActiveStore: () => ({
		activeStore: state.storeId ? { id: state.storeId } : null,
	}),
}));
vi.mock("@/hooks/use-is-owner", () => ({ useIsOwner: () => state.owner }));
vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	api: () => ({
		seller: {
			stores: ({ storeId }: { storeId: string }) => ({
				"order-types": {
					get: async () => ({
						data: {
							data: {
								orderTypes: state.types[storeId].orderTypes,
								offeredOrderTypes: state.types[storeId].offered,
								chargesEnabled: false,
							},
						},
						error: null,
					}),
				},
			}),
		},
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => (
		<a href="/store" data-testid="vendita-link">
			{children}
		</a>
	),
}));

const originalGetLocale = getLocale;

afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
});

function setup() {
	overwriteGetLocale(() => "it");
	const qc = new QueryClient();
	const ui = () => (
		<QueryClientProvider client={qc}>
			<OrderTypesSidebarCard />
		</QueryClientProvider>
	);
	return { ...render(ui()), ui };
}

const row = (label: string) =>
	screen.getByText(label).closest("[data-order-type]") as HTMLElement;

describe("OrderTypesSidebarCard", () => {
	it("mostra ciò che il cliente vede: Paga configurato ma non offerto è spento", async () => {
		state.storeId = "s1";
		state.owner = true;
		state.types = {
			s1: {
				orderTypes: ["reserve_pickup", "pay_pickup"],
				offered: ["reserve_pickup"],
			},
		};
		setup();
		await screen.findByText("Come comprano i clienti");
		expect(row("Prenota e paga in negozio").textContent).toContain("attivo");
		expect(row("Paga e ritira").textContent).toContain("spento");
	});

	it("il titolare può aprire Vendita, il dipendente vede ma non clicca", async () => {
		state.storeId = "s1";
		state.types = {
			s1: { orderTypes: ["reserve_pickup"], offered: ["reserve_pickup"] },
		};
		state.owner = true;
		const { unmount } = setup();
		await screen.findByText("Come comprano i clienti");
		expect(screen.queryByTestId("vendita-link")).not.toBeNull();
		unmount();

		state.owner = false;
		setup();
		await screen.findByText("Come comprano i clienti");
		expect(screen.queryByTestId("vendita-link")).toBeNull();
	});

	it("cambiando negozio mostra le tipologie del nuovo", async () => {
		state.owner = true;
		state.storeId = "s1";
		state.types = {
			s1: { orderTypes: ["reserve_pickup"], offered: ["reserve_pickup"] },
			s2: {
				orderTypes: ["reserve_pickup", "pay_pickup"],
				offered: ["reserve_pickup", "pay_pickup"],
			},
		};
		const { rerender, ui } = setup();
		await screen.findByText("Come comprano i clienti");
		expect(row("Paga e ritira").textContent).toContain("spento");

		state.storeId = "s2";
		rerender(ui());
		await vi.waitFor(() =>
			expect(row("Paga e ritira").textContent).toContain("attivo"),
		);
	});

	it("senza negozio attivo non rende nulla", () => {
		state.storeId = null;
		const { container } = setup();
		expect(container.textContent).toBe("");
	});
});
