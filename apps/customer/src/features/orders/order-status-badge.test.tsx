import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import type { OrderStatus } from "./order-display";
import { OrderStatusBadge } from "./order-status-badge";

const originalGetLocale = getLocale;

afterEach(() => {
	overwriteGetLocale(originalGetLocale);
});

const html = (status: OrderStatus) =>
	renderToStaticMarkup(<OrderStatusBadge status={status} />);

describe("OrderStatusBadge (customer)", () => {
	it("colora ogni stato secondo chi compra", () => {
		const statuses: OrderStatus[] = [
			"pending",
			"confirmed",
			"ready_for_pickup",
			"shipped",
			"delivered",
			"completed",
			"cancelled",
			"expired",
		];
		expect(
			statuses.map((s) => html(s).match(/data-tone="([a-z]+)"/)?.[1]),
		).toEqual([
			"action",
			"waiting",
			"action",
			"waiting",
			"closed",
			"closed",
			"destructive",
			"destructive",
		]);
	});

	it("un ordine completato si legge «Ritirato»", () => {
		overwriteGetLocale(() => "it");
		expect(html("completed")).toContain("Ritirato");
	});
});
