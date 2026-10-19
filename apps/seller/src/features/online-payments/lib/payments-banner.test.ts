// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DISMISS_KEY,
	readDismissed,
	visibleBanner,
	writeDismissed,
} from "./payments-banner";

const NOW = Date.UTC(2026, 9, 19);
const DAY = 24 * 60 * 60 * 1000;
const base = { dismissed: null, now: NOW, onSalesTab: false };

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
});

describe("visibleBanner", () => {
	it("senza stato (dipendente o caricamento) non c'è", () => {
		expect(visibleBanner({ ...base, status: undefined })).toBeNull();
	});

	it("con i pagamenti attivi non c'è", () => {
		expect(visibleBanner({ ...base, status: "enabled" })).toBeNull();
	});

	it("negli altri stati mostra lo stato", () => {
		expect(visibleBanner({ ...base, status: "none" })).toBe("none");
		expect(visibleBanner({ ...base, status: "incomplete" })).toBe("incomplete");
		expect(visibleBanner({ ...base, status: "in_review" })).toBe("in_review");
	});

	it("sulla scheda Vendita non c'è: lì c'è il riquadro", () => {
		expect(
			visibleBanner({ ...base, status: "none", onSalesTab: true }),
		).toBeNull();
	});

	it("chiuso da meno di 7 giorni resta nascosto", () => {
		expect(
			visibleBanner({
				...base,
				status: "none",
				dismissed: { status: "none", at: NOW - 6 * DAY },
			}),
		).toBeNull();
	});

	it("al settimo giorno torna", () => {
		expect(
			visibleBanner({
				...base,
				status: "none",
				dismissed: { status: "none", at: NOW - 7 * DAY },
			}),
		).toBe("none");
	});

	it("se lo stato cambia torna subito", () => {
		expect(
			visibleBanner({
				...base,
				status: "incomplete",
				dismissed: { status: "none", at: NOW - DAY },
			}),
		).toBe("incomplete");
	});
});

describe("readDismissed / writeDismissed", () => {
	it("rilegge quello che ha scritto", () => {
		writeDismissed({ status: "none", at: NOW });
		expect(readDismissed()).toEqual({ status: "none", at: NOW });
	});

	it("un valore rotto vale come mai chiuso", () => {
		localStorage.setItem(DISMISS_KEY, "{rotto");
		expect(readDismissed()).toBeNull();
		localStorage.setItem(DISMISS_KEY, '{"status":"boh","at":1}');
		expect(readDismissed()).toBeNull();
	});

	it("uno storage che lancia non rompe niente", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		expect(readDismissed()).toBeNull();
		expect(() => writeDismissed({ status: "none", at: NOW })).not.toThrow();
	});
});
