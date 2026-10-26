import { afterEach, describe, expect, it } from "vitest";
import { fetchProductDetail } from "./product-detail-api";

/**
 * La prova di C8. Il client di prima, con parseDate: true, trasformava in `Date`
 * ogni stringa che somiglia a una data, dd/mm/yyyy compreso: «05/03/2027»
 * diventava il 3 maggio. Qui il JSON passa dal client vero (`hc` con il fetch
 * globale): il testo deve restare testo.
 */
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function serve(body: unknown) {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify(body), {
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;
}

const detail = {
	id: "p1",
	name: "Passata",
	description: null,
	price: "2.50",
	discountedPrice: null,
	discountPercent: null,
	brandName: null,
	category: null,
	images: [],
	offer: {
		storeProductId: "sp1",
		stock: 3,
		distance: null,
		store: {
			id: "s1",
			name: "Bottega",
			municipality: { id: "m1", name: "Bologna", provinceAcronym: "BO" },
		},
	},
	otherStoreCount: 0,
	requestedStoreUnavailable: false,
	characteristics: [
		{
			characteristicId: "c1",
			name: "Scadenza/TMC",
			dataType: "text",
			unit: null,
			value: "05/03/2027",
		},
		{
			characteristicId: "c2",
			name: "Lotto",
			dataType: "text",
			unit: null,
			value: "05-03-2027",
		},
	],
};

describe("fetchProductDetail", () => {
	it("keeps date-like texts as strings", async () => {
		serve({ success: true, data: detail });

		const view = await fetchProductDetail("p1", { coords: null });

		expect(view?.characteristics.map((c) => c.value)).toEqual([
			"05/03/2027",
			"05-03-2027",
		]);
		expect(typeof view?.characteristics[0].value).toBe("string");
	});

	it("returns null on 404", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({ success: false, message: "Prodotto non trovato" }),
				{
					status: 404,
					headers: { "content-type": "application/json" },
				},
			)) as unknown as typeof fetch;

		expect(await fetchProductDetail("p1", { coords: null })).toBeNull();
	});
});
