import { describe, expect, it } from "vitest";
import { runBulk } from "./bulk";

describe("runBulk", () => {
	it("conta le riuscite e raccoglie le fallite con il loro messaggio", async () => {
		const items = [
			{ name: "Alimentari" },
			{ name: "Bevande" },
			{ name: "Casa" },
		];
		const result = await runBulk(items, async (item) => {
			if (item.name === "Bevande") throw new Error("Ci sono sotto-categorie");
		});
		expect(result).toEqual({
			ok: 2,
			failed: [{ name: "Bevande", message: "Ci sono sotto-categorie" }],
		});
	});

	it("un fallimento non ferma le altre chiamate", async () => {
		const called: string[] = [];
		const result = await runBulk(
			[{ name: "a" }, { name: "b" }],
			async (item) => {
				called.push(item.name);
				throw new Error("no");
			},
		);
		expect(called).toEqual(["a", "b"]);
		expect(result.ok).toBe(0);
		expect(result.failed).toHaveLength(2);
	});
});
