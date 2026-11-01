import { and, eq, inArray, isNull, notExists } from "drizzle-orm";
import { db } from "@/db";
import { order } from "@/db/schemas/order";
import { store } from "@/db/schemas/store";
import { OPEN_ORDER_STATUSES } from "@/domain/orders/order-state-machine";

function openOrders(storeId: string | typeof store.id) {
	return db
		.select({ id: order.id })
		.from(order)
		.where(
			and(
				eq(order.storeId, storeId),
				inArray(order.status, OPEN_ORDER_STATUSES),
			),
		);
}

export async function hasOpenOrders(storeId: string): Promise<boolean> {
	return (await openOrders(storeId).limit(1)).length > 0;
}

/**
 * WHERE di ogni archiviazione: negozio non ancora archiviato e senza ordini
 * aperti, che il titolare deve poter ancora vedere e chiudere. Sta nella
 * stessa UPDATE, così un ordine aperto nel frattempo la blocca.
 */
export function archivableStore() {
	return and(isNull(store.deletedAt), notExists(openOrders(store.id)));
}

/**
 * Archivia il negozio se `archivableStore()`; true se l'ha archiviato adesso.
 * Con ordini aperti lo archivia poi il job archiveEndedStores.
 */
export async function archiveStore(
	executor: Pick<typeof db, "update">,
	storeId: string,
): Promise<boolean> {
	const rows = await executor
		.update(store)
		.set({ deletedAt: new Date() })
		.where(and(eq(store.id, storeId), archivableStore()))
		.returning({ id: store.id });
	return rows.length > 0;
}
