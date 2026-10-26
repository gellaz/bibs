import { z } from "zod";
import { orderStatuses, orderTypes } from "@/db/schemas/order";
import { PaginationQuery } from "./pagination";

// Gemelli Zod di `lib/queries.ts` (D3 del piano Hono), stessi nomi e stesso
// ordine; si aggiungono quando una route migrata li usa.

/**
 * Pagination + optional status/type filters for order list endpoints.
 */
export const OrderListQuery = PaginationQuery.extend({
	status: z
		.enum(orderStatuses)
		.meta({ description: "Filtra per stato dell'ordine" })
		.optional(),
	type: z
		.enum(orderTypes)
		.meta({ description: "Filtra per tipo di ordine" })
		.optional(),
});
