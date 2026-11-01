import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { productsRoutes } from "@/modules/seller/routes/products";
import * as products from "@/modules/seller/services/products";
import { withVars } from "../../../helpers/hono-app";

// Il body del PATCH è quello della creazione reso facoltativo, senza storeId
// (audit 2026-10-11, A1). Un body valido arriva al servizio, spiato: restituisce
// null (404) e si guarda cosa ha ricevuto.
const app = withVars(productsRoutes, {
	user: { id: "u" },
	seller: {
		sellerProfile: { id: "sp" },
		getAccessibleStoreIds: async () => [],
	},
});

const spies: { mockRestore(): void }[] = [];
afterEach(() => {
	for (const spy of spies.splice(0)) spy.mockRestore();
});
function spyUpdate() {
	const spy = spyOn(products, "updateProduct").mockResolvedValue(null);
	spies.push(spy);
	return spy;
}

function patchProduct(body: unknown) {
	return app.request(
		new Request("http://localhost/products/p", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

describe("PATCH /products/:productId — regole della creazione", () => {
	it.each([
		[{ name: "x".repeat(201) }, "Nome: al massimo 200 caratteri"],
		[{ price: "9.9" }, "Il prezzo deve essere nel formato 0.00"],
		// L'`error` dello schema vale anche sotto `.nullable()`.
		[{ ean: "123" }, "EAN deve essere 8 o 13 cifre"],
	])("%j → 422 «%s»", async (body, message) => {
		const res = await patchProduct(body);
		expect(res.status).toBe(422);
		expect((await res.json()).message).toBe(message);
	});

	it("ean e brandId null passano (li tolgono)", async () => {
		const update = spyUpdate();
		const res = await patchProduct({ ean: null, brandId: null });
		expect(res.status).toBe(404);
		expect(update.mock.calls[0][0]).toMatchObject({ ean: null, brandId: null });
	});

	// Il default «22» della creazione riscriverebbe l'aliquota salvata.
	it("senza vatRate l'aliquota non arriva al servizio", async () => {
		const update = spyUpdate();
		await patchProduct({ name: "Pane nero" });
		expect(update.mock.calls[0][0]).not.toHaveProperty("vatRate");
	});
});
