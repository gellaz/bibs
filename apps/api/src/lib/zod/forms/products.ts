import { z } from "zod";

// Gemello Zod di `lib/schemas/forms/products.ts` (D3 del piano Hono). Lo
// schema TypeBox resta per i form del seller FE fino a U11b.

// Aliquote IVA accettate (vedi VAT_RATES in @/lib/vat). Stringhe percentuali;
// `z.union` di letterali per tenere l'ordine in /openapi. Il default lo mette
// anche Elysia, anche in PATCH: si usa con `.optional()`.
export const VatRateSchema = z
	.union([
		z.literal("22"),
		z.literal("10"),
		z.literal("5"),
		z.literal("4"),
		z.literal("0"),
	])
	.meta({ description: "Aliquota IVA (%): 22, 10, 5, 4 o 0" })
	.default("22");
