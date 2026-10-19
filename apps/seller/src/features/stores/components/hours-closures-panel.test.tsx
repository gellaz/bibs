// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { HoursClosuresPanel } from "./hours-closures-panel";

const calls = vi.hoisted(() => ({
	get: vi.fn(),
	put: vi.fn(),
	patch: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	api: () => ({
		seller: {
			stores: () => ({
				patch: calls.patch,
				closures: { get: calls.get, put: calls.put },
			}),
		},
	}),
}));

const originalGetLocale = getLocale;

// Senza `globals` testing-library non registra da sé la pulizia del DOM.
afterEach(() => {
	cleanup();
	overwriteGetLocale(originalGetLocale);
	vi.resetAllMocks();
});

const PAST = { startDate: "2020-08-10", endDate: "2020-08-20", note: "Ferie" };
const UPCOMING = { startDate: "2099-12-24", note: "Natale lungo" };
const ok = (data: unknown) => ({ data: { data }, error: null });

beforeEach(() => {
	overwriteGetLocale(() => "it");
	calls.get.mockResolvedValue(
		ok({ holidays: [], customClosures: [PAST, UPCOMING] }),
	);
});

async function renderPanel() {
	const view = render(
		<QueryClientProvider client={new QueryClient()}>
			<HoursClosuresPanel
				storeId="s1"
				openingHours={[
					{ dayOfWeek: 0, slots: [{ open: "09:00", close: "13:00" }] },
				]}
				readOnly={false}
			/>
		</QueryClientProvider>,
	);
	await screen.findByText(UPCOMING.note);
	return view;
}

const firstTime = (container: HTMLElement) =>
	container.querySelector<HTMLInputElement>(
		'input[type="time"]',
	) as HTMLInputElement;
const save = () =>
	fireEvent.click(screen.getByRole("button", { name: "Salva Modifiche" }));

describe("HoursClosuresPanel", () => {
	it("mentre salva orari e chiusure non si modificano: il salvataggio non riscrive ciò che scrivi", async () => {
		let finish = (_: unknown) => {};
		calls.patch.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const { container } = await renderPanel();
		fireEvent.change(firstTime(container), { target: { value: "10:00" } });
		save();

		await waitFor(() => expect(calls.patch).toHaveBeenCalled());
		expect(firstTime(container).matches(":disabled")).toBe(true);
		expect(
			screen
				.getByRole("button", { name: `Rimuovi ${UPCOMING.note}` })
				.matches(":disabled"),
		).toBe(true);

		finish(ok({}));
		await waitFor(() =>
			expect(firstTime(container).matches(":disabled")).toBe(false),
		);
	});
});
