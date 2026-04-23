import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { order } from "@/db/schemas/order";
import { logger } from "@/lib/logger";
import { expireSingleReservation } from "./expire-reservations";

/** In-memory map of orderId → timer handle. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedules a setTimeout that fires exactly at `expiresAt` to expire a
 * single reserve_pickup order.  Safe to call multiple times for the same
 * orderId — previous timers are cleared first.
 */
export function scheduleExpiry(orderId: string, expiresAt: Date) {
	// Clear any existing timer for this order
	const existing = timers.get(orderId);
	if (existing) clearTimeout(existing);

	const delay = Math.max(expiresAt.getTime() - Date.now(), 0);

	const handle = setTimeout(async () => {
		timers.delete(orderId);
		try {
			const expired = await expireSingleReservation(orderId);
			if (expired) {
				logger.info({ orderId }, "Prenotazione scaduta via timer");
			}
		} catch (error) {
			logger.error({ orderId, err: error }, "Errore scadenza prenotazione");
		}
	}, delay);

	timers.set(orderId, handle);
}

/**
 * Clears a scheduled timer (e.g. when an order is picked up or cancelled
 * before expiry).
 */
export function clearExpiry(orderId: string) {
	const handle = timers.get(orderId);
	if (handle) {
		clearTimeout(handle);
		timers.delete(orderId);
	}
}

/**
 * Clears all scheduled reservation timers. Called during graceful shutdown.
 */
export function clearAllTimers() {
	for (const handle of timers.values()) {
		clearTimeout(handle);
	}
	timers.clear();
}

/**
 * On startup, re-schedules timers for all active reserve_pickup orders
 * that still have a future (or just-passed) reservation window.
 * Orders already past their expiry will fire immediately (delay = 0).
 */
export async function restoreTimers() {
	const active = await db.query.order.findMany({
		where: and(
			eq(order.type, "reserve_pickup"),
			inArray(order.status, ["confirmed", "ready_for_pickup"]),
		),
		columns: { id: true, reservationExpiresAt: true },
	});

	for (const o of active) {
		if (o.reservationExpiresAt) {
			scheduleExpiry(o.id, o.reservationExpiresAt);
		}
	}

	if (active.length > 0) {
		logger.info({ count: active.length }, "Timer prenotazioni ripristinati");
	}
}
