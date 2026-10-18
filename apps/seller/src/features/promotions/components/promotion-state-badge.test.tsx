import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	type DiscountStatus,
	PromotionStateBadge,
} from "./promotion-state-badge";

const DAY = 86_400_000;

const toneOf = (status: DiscountStatus, startsAt: Date) =>
	renderToStaticMarkup(
		<PromotionStateBadge status={status} startsAt={startsAt} endsAt={null} />,
	).match(/data-tone="([a-z]+)"/)?.[1];

describe("PromotionStateBadge", () => {
	it("in corso, pianificata, in pausa e conclusa hanno il loro tono", () => {
		const past = new Date(Date.now() - DAY);
		const future = new Date(Date.now() + DAY);
		expect(toneOf("active", past)).toBe("success");
		expect(toneOf("active", future)).toBe("waiting");
		expect(toneOf("paused", past)).toBe("closed");
		expect(toneOf("archived", past)).toBe("closed");
	});
});
