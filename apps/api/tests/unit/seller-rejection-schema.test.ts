import { describe, expect, it } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { RejectSellerBody } from "@/lib/schemas/forms";

describe("RejectSellerBody", () => {
	it("rifiuta motivo vuoto, di soli spazi o troppo lungo", () => {
		expect(Value.Check(RejectSellerBody, { reason: "", fixStep: null })).toBe(
			false,
		);
		expect(
			Value.Check(RejectSellerBody, { reason: "   ", fixStep: null }),
		).toBe(false);
		expect(
			Value.Check(RejectSellerBody, {
				reason: "x".repeat(501),
				fixStep: null,
			}),
		).toBe(false);
	});

	it("accetta motivo + fixStep validi, rifiuta step sconosciuti", () => {
		expect(
			Value.Check(RejectSellerBody, {
				reason: "Documento illeggibile",
				fixStep: "document",
			}),
		).toBe(true);
		expect(
			Value.Check(RejectSellerBody, { reason: "Altro", fixStep: "shipping" }),
		).toBe(false);
	});
});
