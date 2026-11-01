import { describe, expect, it } from "bun:test";
import { ServiceError } from "@/lib/errors";
import { productsRoutes } from "@/modules/seller/routes/products";
import { withVars } from "../../../helpers/hono-app";

// Come store-update-validation: un body valido passa la validazione e arriva
// all'handler, che si ferma con 403 prima del DB. Il body del PATCH è quello
// della creazione reso facoltativo, senza storeId (audit 2026-10-11, A1).
const app = withVars(productsRoutes, {
	user: { id: "u" },
	seller: {
		sellerProfile: { id: "sp" },
		getAccessibleStoreIds: async () => {
			throw new ServiceError(403, "fermo prima del DB");
		},
	},
});

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
		const res = await patchProduct({ ean: null, brandId: null });
		expect(res.status).toBe(403);
	});
});
