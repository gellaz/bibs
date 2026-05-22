// apps/api/src/lib/schemas/stock.ts
import { t } from "elysia";
import { StoreProductSchema } from "./entities";

export const StockAdjustBody = t.Object({
	delta: t.Integer({
		minimum: -1000,
		maximum: 1000,
		description:
			"Variazione di stock (intero, segno + per aumentare, - per diminuire). 0 è ammesso ma no-op.",
	}),
});

export const StockBulkAdjustBody = t.Union([
	t.Object({
		storeId: t.String({ description: "ID negozio attivo del chiamante" }),
		mode: t.Literal("delta", {
			description: "Somma algebrica di `value` allo stock corrente",
		}),
		value: t.Integer({
			minimum: -1000,
			maximum: 1000,
			description: "Variazione (segno + per aumentare, - per diminuire).",
		}),
		productIds: t.Array(t.String(), {
			minItems: 1,
			maxItems: 100,
			description: "ID dei prodotti su cui applicare l'operazione",
		}),
	}),
	t.Object({
		storeId: t.String({ description: "ID negozio attivo del chiamante" }),
		mode: t.Literal("set", {
			description: "Imposta lo stock a `value` per ogni prodotto",
		}),
		value: t.Integer({
			minimum: 0,
			maximum: 100000,
			description: "Valore assoluto da impostare.",
		}),
		productIds: t.Array(t.String(), {
			minItems: 1,
			maxItems: 100,
			description: "ID dei prodotti su cui applicare l'operazione",
		}),
	}),
]);

export const StockBulkAdjustResult = t.Object({
	succeeded: t.Array(StoreProductSchema),
	failed: t.Array(
		t.Object({
			productId: t.String(),
			reason: t.Union([t.Literal("not_found"), t.Literal("would_go_negative")]),
		}),
	),
});
