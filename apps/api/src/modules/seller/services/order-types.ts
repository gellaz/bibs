import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import {
	offeredOrderTypes,
	type StoreOrderType,
	storeOrderTypes,
} from "@/lib/order-types";
import { getDefaultPaymentMethod } from "@/modules/billing/services/connect-account";

interface StoreRef {
	sellerProfileId: string;
	storeId: string;
}

async function ownStore({ sellerProfileId, storeId }: StoreRef) {
	const found = await db.query.store.findFirst({
		where: and(
			eq(store.id, storeId),
			eq(store.sellerProfileId, sellerProfileId),
			isNull(store.deletedAt),
		),
		columns: { id: true, orderTypes: true },
	});
	if (!found) throw new ServiceError(404, "Negozio non trovato");
	return found;
}

function view(orderTypes: StoreOrderType[], chargesEnabled: boolean) {
	return {
		orderTypes,
		offeredOrderTypes: offeredOrderTypes(orderTypes, { chargesEnabled }),
		chargesEnabled,
	};
}

export async function getStoreOrderTypes(ref: StoreRef) {
	const [s, pm] = await Promise.all([
		ownStore(ref),
		getDefaultPaymentMethod(ref.sellerProfileId),
	]);
	return view(s.orderTypes, pm?.chargesEnabled ?? false);
}

export async function updateStoreOrderTypes(
	ref: StoreRef & { orderTypes: StoreOrderType[] },
) {
	const [s, pm] = await Promise.all([
		ownStore(ref),
		getDefaultPaymentMethod(ref.sellerProfileId),
	]);
	const chargesEnabled = pm?.chargesEnabled ?? false;
	// Ordine canonico e senza doppioni, qualunque cosa mandi il client.
	const next = storeOrderTypes.filter((t) => ref.orderTypes.includes(t));

	const adding =
		next.includes("pay_pickup") && !s.orderTypes.includes("pay_pickup");
	if (adding && !chargesEnabled)
		throw new ServiceError(
			400,
			"Per «Paga e ritira» attiva prima i pagamenti online",
		);
	if (offeredOrderTypes(next, { chargesEnabled }).length === 0)
		throw new ServiceError(
			400,
			"Deve restare almeno una tipologia d'acquisto disponibile ai clienti",
		);

	await db.update(store).set({ orderTypes: next }).where(eq(store.id, s.id));
	return view(next, chargesEnabled);
}
