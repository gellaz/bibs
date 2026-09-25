import { and, asc, eq, gt, like } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { customerProfile } from "@/db/schemas/customer";
import { order } from "@/db/schemas/order";
import { product, storeProduct } from "@/db/schemas/product";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { expireReservations } from "@/lib/jobs/expire-reservations";
import { publiclyVisibleStore } from "@/lib/store-visibility";
import { cancelOrder, createOrder } from "@/modules/customer/services/orders";
import { transitionOrder } from "@/modules/seller/services/orders";

const SELLER_EMAIL = "seller1@test.com";

type Plan = {
	type: "reserve_pickup" | "pay_pickup";
	end: "confirmed" | "ready_for_pickup" | "completed" | "cancelled" | "expired";
};

// 12 ordini: la lista seller ha tutte le tab popolate e i due tipi.
const PLANS: Plan[] = [
	{ type: "reserve_pickup", end: "confirmed" },
	{ type: "reserve_pickup", end: "confirmed" },
	{ type: "pay_pickup", end: "confirmed" },
	{ type: "reserve_pickup", end: "ready_for_pickup" },
	{ type: "pay_pickup", end: "ready_for_pickup" },
	{ type: "pay_pickup", end: "ready_for_pickup" },
	{ type: "reserve_pickup", end: "completed" },
	{ type: "pay_pickup", end: "completed" },
	{ type: "reserve_pickup", end: "cancelled" },
	{ type: "pay_pickup", end: "cancelled" },
	{ type: "reserve_pickup", end: "expired" },
	{ type: "reserve_pickup", end: "confirmed" },
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

	const customers = await db
		.select({ id: customerProfile.id })
		.from(customerProfile)
		.innerJoin(user, eq(user.id, customerProfile.userId))
		.where(like(user.email, "customer%@test.com"))
		.orderBy(asc(user.email))
		.limit(PLANS.length);

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
			type: plan.type,
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
			await expireReservations();
		}
	}
}
