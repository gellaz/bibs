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
import { m } from "@/paraglide/messages";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { SalesSettingsPanel } from "./sales-settings-panel";

const calls = vi.hoisted(() => ({
	typesGet: vi.fn(),
	patch: vi.fn(),
	settingsGet: vi.fn(),
	onboardingPost: vi.fn(),
	syncPost: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
	// Finto client `hc`: le risposte dei test restano { data, error } come con
	// Eden e diventano risposte HTTP (ok, status, json) per `unwrapJson`.
	const http = async (
		pending: Promise<{
			data: unknown;
			error: { status: number; value: unknown } | null;
		}>,
	) => {
		const { data, error } = await pending;
		return error
			? { ok: false, status: error.status, json: async () => error.value }
			: { ok: true, status: 200, json: async () => data };
	};
	return {
		...(await importOriginal<typeof import("@/lib/api")>()),
		sellerApi: {
			stores: {
				":storeId": {
					$patch: ({ json }: { json: unknown }) => http(calls.patch(json)),
					"order-types": { $get: () => http(calls.typesGet()) },
				},
			},
			settings: {
				$get: () => http(calls.settingsGet()),
				payments: {
					onboarding: { $post: () => http(calls.onboardingPost()) },
					sync: { $post: () => http(calls.syncPost()) },
				},
			},
		},
	};
});

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

type Status = "none" | "incomplete" | "in_review" | "enabled";

function mockApi(opts: {
	status: Status;
	payoutsEnabled?: boolean;
	orderTypes?: ("reserve_pickup" | "pay_pickup")[];
	chargesEnabled?: boolean;
}) {
	const orderTypes = opts.orderTypes ?? ["reserve_pickup"];
	const chargesEnabled = opts.chargesEnabled ?? opts.status === "enabled";
	calls.typesGet.mockResolvedValue({
		data: {
			data: {
				orderTypes,
				offeredOrderTypes: orderTypes.filter(
					(t) => t === "reserve_pickup" || chargesEnabled,
				),
				chargesEnabled,
			},
		},
		error: null,
	});
	calls.settingsGet.mockResolvedValue({
		data: {
			data: {
				onlinePayments: {
					status: opts.status,
					payoutsEnabled: opts.payoutsEnabled ?? false,
				},
			},
		},
		error: null,
	});
}

function renderPanel(qc = new QueryClient()) {
	render(
		<QueryClientProvider client={qc}>
			<SalesSettingsPanel
				storeId="s1"
				reservationHours={24}
				lowStockThreshold={5}
				hasOpeningHours={false}
			/>
		</QueryClientProvider>,
	);
	return qc;
}

describe("pagamenti online nella scheda Vendita", () => {
	it("da attivare: spiega e porta su Stripe, niente giro dal Profilo", async () => {
		overwriteGetLocale(() => "it");
		mockApi({ status: "none" });
		renderPanel();
		expect(
			await screen.findByRole("button", { name: "Attiva pagamenti online" }),
		).toBeTruthy();
		expect(screen.getByText(m.payments_none_body())).toBeTruthy();
		expect(screen.queryByText("Vai ai pagamenti online")).toBeNull();
	});

	it("sul giallo il badge ha un fondo pieno: il tinto al 12% non regge AA in scuro", async () => {
		overwriteGetLocale(() => "it");
		mockApi({ status: "none" });
		renderPanel();
		const badge = (await screen.findByText("Da attivare")).closest(
			"[data-slot='status-badge']",
		) as HTMLElement;
		expect(badge.className).toContain("bg-background");
		expect(badge.className).not.toContain("bg-action/12");
	});

	it("da completare: aggiorna stato e completa", async () => {
		overwriteGetLocale(() => "it");
		mockApi({ status: "incomplete" });
		renderPanel();
		expect(
			await screen.findByRole("button", { name: "Completa l'attivazione" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Aggiorna stato" })).toBeTruthy();
	});

	it("attivi: vale per tutti i negozi e avvisa dei versamenti in attesa", async () => {
		overwriteGetLocale(() => "it");
		mockApi({ status: "enabled", payoutsEnabled: false });
		renderPanel();
		expect(await screen.findByText("Pagamenti online attivi")).toBeTruthy();
		expect(screen.getByText("Vale per tutti i tuoi negozi.")).toBeTruthy();
		expect(
			screen.getByText(
				"I versamenti sul tuo conto partono appena Stripe completa la verifica.",
			),
		).toBeTruthy();
	});

	it("Paga e ritira acceso ma account non più abilitato: lo dice", async () => {
		overwriteGetLocale(() => "it");
		mockApi({
			status: "incomplete",
			orderTypes: ["reserve_pickup", "pay_pickup"],
			chargesEnabled: false,
		});
		renderPanel();
		expect(
			await screen.findByText(m.store_order_types_pay_account_disabled()),
		).toBeTruthy();
	});

	it("Paga e ritira acceso ma Stripe mai attivato: niente «non più abilitati»", async () => {
		overwriteGetLocale(() => "it");
		mockApi({
			status: "none",
			orderTypes: ["reserve_pickup", "pay_pickup"],
			chargesEnabled: false,
		});
		renderPanel();
		await screen.findByRole("button", { name: "Attiva pagamenti online" });
		expect(
			screen.queryByText(m.store_order_types_pay_account_disabled()),
		).toBeNull();
	});

	it("quando Stripe abilita l'account rilegge le tipologie", async () => {
		overwriteGetLocale(() => "it");
		mockApi({ status: "incomplete" });
		const qc = renderPanel();
		await screen.findByRole("button", { name: "Completa l'attivazione" });
		expect(calls.typesGet).toHaveBeenCalledTimes(1);
		qc.setQueryData(["seller", "settings"], {
			onlinePayments: { status: "enabled", payoutsEnabled: true },
		});
		await waitFor(() => expect(calls.typesGet).toHaveBeenCalledTimes(2));
	});
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
