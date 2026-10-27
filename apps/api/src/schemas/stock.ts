import { z } from "zod";
import { StoreProductSchema } from "./entities";
import { zInteger } from "./t";

// Gemelli Zod di `lib/schemas/stock.ts` (D3 del piano Hono).

export const StockAdjustBody = z.object({
	delta: zInteger({
		minimum: -1000,
		maximum: 1000,
		description:
			"Variazione di stock (intero, segno + per aumentare, - per diminuire). 0 è ammesso ma no-op.",
	}),
});

const bulkStoreId = z
	.string()
	.meta({ description: "ID negozio attivo del chiamante" });
const bulkProductIds = z
	.array(z.string())
	.min(1)
	.max(100)
	.meta({ description: "ID dei prodotti su cui applicare l'operazione" });

// `z.union`, mai `z.discriminatedUnion`: stessi errori di prima (Trappole).
export const StockBulkAdjustBody = z.union([
	z.object({
		storeId: bulkStoreId,
		mode: z
			.literal("delta")
			.meta({ description: "Somma algebrica di `value` allo stock corrente" }),
		value: zInteger({
			minimum: -1000,
			maximum: 1000,
			description: "Variazione (segno + per aumentare, - per diminuire).",
		}),
		productIds: bulkProductIds,
	}),
	z.object({
		storeId: bulkStoreId,
		mode: z
			.literal("set")
			.meta({ description: "Imposta lo stock a `value` per ogni prodotto" }),
		value: zInteger({
			minimum: 0,
			maximum: 100000,
			description: "Valore assoluto da impostare.",
		}),
		productIds: bulkProductIds,
	}),
]);

export const StockBulkAdjustResult = z.object({
	succeeded: z.array(StoreProductSchema),
	failed: z.array(
		z.object({
			productId: z.string(),
			reason: z.enum(["not_found", "would_go_negative"]),
		}),
	),
});
