import { describe, expect, it } from "bun:test";
import { closuresRoutes } from "@/modules/seller/routes/closures";
import { withVars } from "../../../helpers/hono-app";

// Mounted with a resolved non-owner (withVars skips the seller guard),
// so requireOwner must produce a 403 before the handler runs.
const app = withVars(closuresRoutes, {
	user: { id: "u" },
	seller: { isOwner: false },
});

async function call(method: string, path: string, body?: unknown) {
	return app.request(
		new Request(`http://localhost${path}`, {
			method,
			...(body
				? {
						body: JSON.stringify(body),
						headers: { "content-type": "application/json" },
					}
				: {}),
		}),
	);
}

describe("seller closures routes are owner-only", () => {
	it("GET /stores/:id/closures → 403 for a non-owner", async () => {
		const res = await call("GET", "/stores/some-id/closures");
		expect(res.status).toBe(403);
	});

	it("PUT /stores/:id/closures → 403 for a non-owner", async () => {
		const res = await call("PUT", "/stores/some-id/closures", {
			optOutIds: [],
			customClosures: [],
		});
		expect(res.status).toBe(403);
	});
});
