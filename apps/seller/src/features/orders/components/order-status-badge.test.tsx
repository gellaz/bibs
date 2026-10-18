import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OrderStatus } from "../order-labels";
import { OrderStatusBadge } from "./order-status-badge";

const toneOf = (status: OrderStatus) =>
	renderToStaticMarkup(<OrderStatusBadge status={status} />).match(
		/data-tone="([a-z]+)"/,
	)?.[1];

describe("OrderStatusBadge", () => {
	it("colora ogni stato secondo chi vende", () => {
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
		expect(statuses.map(toneOf)).toEqual([
			"waiting",
			"action",
			"success",
			"success",
			"closed",
			"closed",
			"destructive",
			"destructive",
		]);
	});
});
