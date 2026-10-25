import { describe, expect, it } from "vitest";
import { requestCountsQuery } from "./use-request-counts";

describe("requestCountsQuery", () => {
	// Dialog di moderazione e dettaglio invalidano il prefisso "admin-requests":
	// con una chiave diversa il badge del menu resterebbe vecchio.
	it("sta sotto il prefisso invalidato da approvazione, rifiuto e moderazione", () => {
		expect(requestCountsQuery.queryKey[0]).toBe("admin-requests");
	});
});
