import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { subscriptionStatusBadge } from "./subscription-status";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

const STATUSES = [
	"active",
	"past_due",
	"canceling",
	"suspended",
	"canceled",
] as const;

describe("subscriptionStatusBadge", () => {
	it("etichetta i cinque stati in italiano, col tono per l'admin", () => {
		overwriteGetLocale(() => "it");
		expect(
			STATUSES.map((s) => {
				const { label, tone } = subscriptionStatusBadge(s);
				return { label, tone };
			}),
		).toEqual([
			{ label: "Attivo", tone: "success" },
			{ label: "Rinnovo fallito", tone: "destructive" },
			{ label: "In cancellazione", tone: "closed" },
			{ label: "Sospeso", tone: "destructive" },
			{ label: "Cancellato", tone: "closed" },
		]);
	});

	it("follows the current language", () => {
		overwriteGetLocale(() => "en");
		expect(STATUSES.map((s) => subscriptionStatusBadge(s).label)).toEqual([
			"Active",
			"Renewal failed",
			"Deletion scheduled",
			"Suspended",
			"Deleted",
		]);
	});

	it("uno stato sconosciuto resta grezzo", () => {
		overwriteGetLocale(() => "it");
		const { label, tone } = subscriptionStatusBadge("pending");
		expect({ label, tone }).toEqual({ label: "pending", tone: "closed" });
	});
});
