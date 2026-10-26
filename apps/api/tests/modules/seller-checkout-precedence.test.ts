import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { ServiceError } from "@/lib/errors";
import { sellerApp } from "@/modules/seller";
import * as checkout from "@/modules/seller/services/checkout";
import { testRequest, withVars } from "../helpers/hono-app";

// In Elysia la route statica vince: `GET /seller/stores/checkout/closures` è il
// form in sospeso con id «closures», non le chiusure del negozio «checkout».
// In Hono vince la prima registrata, quindi in `sellerApp` il checkout deve
// stare prima delle route `/stores/:storeId/…` di U6 (anche dopo il merge).

const app = withVars(sellerApp, {
	user: { id: "u1" },
	seller: {
		isOwner: true,
		sellerProfile: { id: "sp1", onboardingStatus: "active" },
		accessCtx: { userId: "u1", sellerProfileId: "sp1", isOwner: true },
		getAccessibleStoreIds: async () => ["s1"],
	},
});

const NOT_FOUND = "Checkout in sospeso non trovato o già utilizzato";
let spy: ReturnType<typeof spyOn> | undefined;
afterEach(() => spy?.mockRestore());

describe("GET /stores/checkout/:pendingId prima di /stores/:storeId/…", () => {
	for (const pendingId of ["closures", "order-types", "reservation-preview"])
		it(`/stores/checkout/${pendingId} → form in sospeso`, async () => {
			spy = spyOn(checkout, "getPendingForResume").mockRejectedValue(
				new ServiceError(404, NOT_FOUND),
			);
			const res = await testRequest(app, `/stores/checkout/${pendingId}`);
			expect(spy).toHaveBeenCalledWith({ sellerProfileId: "sp1", pendingId });
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({
				success: false,
				error: "NOT_FOUND",
				message: NOT_FOUND,
			});
		});
});
