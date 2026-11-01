import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { storeSubscription } from "@/db/schemas/store-subscription";
import { notifyStoreCanceled } from "@/domain/billing/billing-notifications";
import { archivableStore } from "@/domain/stores/store-archive";

/**
 * Archivia i negozi rimasti fuori dall'archivio ad abbonamento chiuso perché
 * avevano ordini aperti, ora che sono tutti chiusi. Stessa email del webhook
 * subscription.deleted; una sola UPDATE, quindi mai due volte.
 */
export async function archiveEndedStores(): Promise<number> {
	const archived = await db
		.update(store)
		.set({ deletedAt: new Date() })
		.from(storeSubscription)
		.where(
			and(
				eq(storeSubscription.storeId, store.id),
				eq(storeSubscription.status, "canceled"),
				archivableStore(),
			),
		)
		.returning({
			storeId: store.id,
			cancelReason: storeSubscription.cancelReason,
		});

	for (const { storeId, cancelReason } of archived)
		await notifyStoreCanceled({
			storeId,
			cancelReason: cancelReason ?? "payment_failed_auto",
		});
	return archived.length;
}
