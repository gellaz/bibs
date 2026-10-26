import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { product, storeProduct } from "@/db/schemas/product";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { expireSingleReservation } from "@/domain/orders/reservation-expiry";
import { publiclyVisibleStore } from "@/domain/stores/store-visibility";
import { cancelOrder, createOrder } from "@/modules/customer/services/orders";
import { transitionOrder } from "@/modules/seller/services/orders";
import { SEED_RESERVATION_DAYS, seedCustomerEmails } from "./utils";

const SELLER_EMAIL = "seller1@test.com";

type Plan = {
	end: "confirmed" | "ready_for_pickup" | "completed" | "cancelled" | "expired";
};

// 12 ordini: la lista seller ha tutte le tab popolate. Solo prenotazioni: il
// pay_pickup richiede un PaymentIntent vero, che il seed non ha.
const PLANS: Plan[] = [
	{ end: "confirmed" },
	{ end: "confirmed" },
	{ end: "confirmed" },
	{ end: "ready_for_pickup" },
	{ end: "ready_for_pickup" },
	{ end: "ready_for_pickup" },
	{ end: "completed" },
	{ end: "completed" },
	{ end: "cancelled" },
	{ end: "cancelled" },
	{ end: "expired" },
	{ end: "confirmed" },
];

export async function seedOrders() {
	const [target] = await db
		.select({ storeId: store.id, sellerProfileId: sellerProfile.id })
		.from(store)
		.innerJoin(sellerProfile, eq(sellerProfile.id, store.sellerProfileId))
		.innerJoin(user, eq(user.id, sellerProfile.userId))
		// Solo un negozio vendibile: createOrder rifiuta gli altri.
		.where(and(eq(user.email, SELLER_EMAIL), publiclyVisibleStore()))
		.orderBy(asc(store.createdAt))
		.limit(1);
	if (!target) {
		console.warn(`  ⚠️ ${SELLER_EMAIL} senza negozi: nessun ordine seedato`);
		return;
	}

	const already = await db.query.order.findFirst({
		where: eq(order.storeId, target.storeId),
	});
	if (already) {
		console.log("  ⏭ Orders already seeded, skipping");
		return;
	}

	const products = await db
		.select({ id: storeProduct.id })
		.from(storeProduct)
		.innerJoin(product, eq(product.id, storeProduct.productId))
		.where(
			and(
				eq(storeProduct.storeId, target.storeId),
				eq(product.status, "active"),
				gt(storeProduct.stock, 5),
			),
		)
		.orderBy(asc(storeProduct.id))
		.limit(PLANS.length + 2);
	if (products.length < 3) {
		console.warn("  ⚠️ Negozio senza prodotti vendibili: nessun ordine seedato");
		return;
	}

	const emails = seedCustomerEmails(PLANS.length);
	const customers = await db
		.select({ id: customerProfile.id, email: user.email })
		.from(customerProfile)
		.innerJoin(user, eq(user.id, customerProfile.userId))
		.where(inArray(user.email, emails));
	customers.sort((a, b) => emails.indexOf(a.email) - emails.indexOf(b.email));

	console.log(`  🧾 Seeding ${PLANS.length} orders for ${SELLER_EMAIL}...`);

	for (const [i, plan] of PLANS.entries()) {
		const customerProfileId = customers[i % customers.length].id;
		// 1–3 righe per ordine, passo coprimo con la lunghezza della lista.
		const lineCount = (i % 3) + 1;
		const items = Array.from({ length: lineCount }, (_, k) => ({
			storeProductId: products[(i * 5 + k) % products.length].id,
			quantity: (k % 2) + 1,
		}));

		const created = await createOrder({
			customerProfileId,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId: target.storeId,
			items,
		});

		const storeIds = [target.storeId];
		if (plan.end === "ready_for_pickup" || plan.end === "completed")
			await transitionOrder(
				created.id,
				target.sellerProfileId,
				"ready_for_pickup",
				storeIds,
			);
		if (plan.end === "completed")
			await transitionOrder(
				created.id,
				target.sellerProfileId,
				"completed",
				storeIds,
			);
		if (plan.end === "cancelled")
			await cancelOrder({ orderId: created.id, customerProfileId });
		if (plan.end === "expired") {
			await db
				.update(order)
				.set({ reservationExpiresAt: new Date(Date.now() - 60_000) })
				.where(eq(order.id, created.id));
			// Diretto, non il cron: il cron aspetta i 15 minuti di tolleranza.
			await expireSingleReservation(created.id);
		}
	}

	// Dopo il loop, così nessuna transizione ricalcola la scadenza. Le scadute
	// volute restano com'erano.
	await db
		.update(order)
		.set({
			reservationExpiresAt: new Date(
				Date.now() + SEED_RESERVATION_DAYS * 86_400_000,
			),
		})
		.where(
			and(
				eq(order.storeId, target.storeId),
				eq(order.type, "reserve_pickup"),
				inArray(order.status, ["confirmed", "ready_for_pickup"]),
			),
		);
}
