import { describe, expect, it } from "bun:test";
import { RejectSellerBody } from "@/lib/schemas/forms";

describe("RejectSellerBody", () => {
	it("rifiuta motivo vuoto, di soli spazi o troppo lungo", () => {
		expect(
			RejectSellerBody.safeParse({ reason: "", fixStep: null }).success,
		).toBe(false);
		expect(
			RejectSellerBody.safeParse({ reason: "   ", fixStep: null }).success,
		).toBe(false);
		expect(
			RejectSellerBody.safeParse({
				reason: "x".repeat(501),
				fixStep: null,
			}).success,
		).toBe(false);
	});

	it("accetta motivo + fixStep validi, rifiuta step sconosciuti", () => {
		expect(
			RejectSellerBody.safeParse({
				reason: "Documento illeggibile",
				fixStep: "document",
			}).success,
		).toBe(true);
		expect(
			RejectSellerBody.safeParse({ reason: "Altro", fixStep: "shipping" })
				.success,
		).toBe(false);
	});
});
