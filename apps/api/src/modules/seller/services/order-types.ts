import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { getDefaultPaymentMethod } from "@/domain/billing/connect-account";
import {
	offeredOrderTypes,
	type StoreOrderType,
	storeOrderTypes,
} from "@/domain/orders/order-types";
import { resolveReservationDeadlines } from "@/domain/stores/store-open-status";
import { ServiceError } from "@/lib/errors";
import { ensureStoreOwnership } from "../context";

interface StoreRef {
	sellerProfileId: string;
	storeId: string;
}

async function isVatChangeBlocked(sellerProfileId: string) {
	const [row] = await db
		.select({ blocked: sellerProfile.vatChangeBlocked })
		.from(sellerProfile)
		.where(eq(sellerProfile.id, sellerProfileId));
	return row?.blocked ?? false;
}

function view(
	orderTypes: StoreOrderType[],
	chargesEnabled: boolean,
	vatChangeBlocked: boolean,
) {
	return {
		orderTypes,
		offeredOrderTypes: offeredOrderTypes(orderTypes, {
			chargesEnabled,
			vatChangeBlocked,
		}),
		chargesEnabled,
		vatChangeBlocked,
	};
}

export async function getStoreOrderTypes(ref: StoreRef) {
	const [s, pm, blocked] = await Promise.all([
		ensureStoreOwnership(ref.storeId, ref.sellerProfileId),
		getDefaultPaymentMethod(ref.sellerProfileId),
		isVatChangeBlocked(ref.sellerProfileId),
	]);
	return view(s.orderTypes, pm?.chargesEnabled ?? false, blocked);
}

export async function updateStoreOrderTypes(
	ref: StoreRef & { orderTypes: StoreOrderType[] },
) {
	const [s, pm, blocked] = await Promise.all([
		ensureStoreOwnership(ref.storeId, ref.sellerProfileId),
		getDefaultPaymentMethod(ref.sellerProfileId),
		isVatChangeBlocked(ref.sellerProfileId),
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
	// Il blocco IVA è temporaneo: non deve impedire di salvare una scelta valida (spec §3).
	if (
		offeredOrderTypes(next, { chargesEnabled, vatChangeBlocked: false })
			.length === 0
	)
		throw new ServiceError(
			400,
			"Deve restare almeno una tipologia d'acquisto disponibile ai clienti",
		);

	await db.update(store).set({ orderTypes: next }).where(eq(store.id, s.id));
	return view(next, chargesEnabled, blocked);
}

/** Scadenza che avrebbe adesso una prenotazione con `hours` ore, senza salvarle. */
export async function previewReservationDeadline(
	ref: StoreRef & { hours: number },
) {
	const s = await ensureStoreOwnership(ref.storeId, ref.sellerProfileId);
	const deadlines = await resolveReservationDeadlines(
		[{ ...s, reservationHours: ref.hours }],
		new Date(),
	);
	return deadlines.get(s.id)!;
}
