import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import {
	offeredOrderTypes,
	type StoreOrderType,
	storeOrderTypes,
} from "@/lib/order-types";
import { resolveReservationDeadlines } from "@/lib/store-open-status";
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
		columns: { id: true, orderTypes: true, openingHours: true, closures: true },
	});
	if (!found) throw new ServiceError(404, "Negozio non trovato");
	return found;
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
		ownStore(ref),
		getDefaultPaymentMethod(ref.sellerProfileId),
		isVatChangeBlocked(ref.sellerProfileId),
	]);
	return view(s.orderTypes, pm?.chargesEnabled ?? false, blocked);
}

export async function updateStoreOrderTypes(
	ref: StoreRef & { orderTypes: StoreOrderType[] },
) {
	const [s, pm, blocked] = await Promise.all([
		ownStore(ref),
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
	const s = await ownStore(ref);
	const deadlines = await resolveReservationDeadlines(
		[{ ...s, reservationHours: ref.hours }],
		new Date(),
	);
	return deadlines.get(s.id)!;
}
