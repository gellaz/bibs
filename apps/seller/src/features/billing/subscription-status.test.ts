import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { subscriptionStatusBadge } from "./subscription-status";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

describe("subscriptionStatusBadge (seller)", () => {
	it("etichetta gli stati col tono per chi paga", () => {
		overwriteGetLocale(() => "it");
		expect(
			["active", "past_due", "canceling", "suspended"].map((s) => {
				const { label, tone } = subscriptionStatusBadge(s);
				return { label, tone };
			}),
		).toEqual([
			{ label: "Attivo", tone: "success" },
			{ label: "Rinnovo fallito", tone: "destructive" },
			{ label: "In cancellazione", tone: "waiting" },
			{ label: "Sospeso", tone: "destructive" },
		]);
	});

	it("uno stato sconosciuto resta grezzo", () => {
		const { label, tone } = subscriptionStatusBadge("trialing");
		expect({ label, tone }).toEqual({ label: "trialing", tone: "closed" });
	});
});
