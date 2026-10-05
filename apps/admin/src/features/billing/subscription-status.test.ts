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
	it("etichetta i cinque stati in italiano, con la variante del seller", () => {
		overwriteGetLocale(() => "it");
		expect(STATUSES.map(subscriptionStatusBadge)).toEqual([
			{ label: "Attivo", variant: "default" },
			{ label: "Rinnovo fallito", variant: "destructive" },
			{ label: "In cancellazione", variant: "outline" },
			{ label: "Sospeso", variant: "destructive" },
			{ label: "Cancellato", variant: "secondary" },
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
		expect(subscriptionStatusBadge("pending")).toEqual({
			label: "pending",
			variant: "outline",
		});
	});
});
