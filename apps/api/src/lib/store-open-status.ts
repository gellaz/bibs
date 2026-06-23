import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { holidayDefinition } from "@/db/schemas/holiday-definition";
import { storeHolidayOptout } from "@/db/schemas/store-holiday-optout";
import type {
	CustomClosure,
	HolidayDef,
	OpeningHoursDay,
	OpenStatus,
} from "@/lib/holidays";
import {
	addDaysYMD,
	getOpenStatus,
	resolveStoreClosedDates,
} from "@/lib/holidays";

interface StoreOpenStatusInput {
	id: string;
	openingHours: OpeningHoursDay[] | null;
	closures: CustomClosure[] | null;
}

/**
 * Computes the current open-status for a batch of stores (one DB round-trip for
 * holiday definitions + opt-outs, then pure in-memory resolution per store).
 * "Now" is evaluated in Europe/Rome. Returns a map keyed by store id.
 */
export async function resolveOpenStatuses(
	stores: StoreOpenStatusInput[],
	now: Date,
): Promise<Map<string, OpenStatus>> {
	const today = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Rome",
	}).format(now);
	const windowEnd = addDaysYMD(today, 60);
	const storeIds = stores.map((s) => s.id);

	const [activeDefs, optOutRows] = await Promise.all([
		db.query.holidayDefinition.findMany({
			where: eq(holidayDefinition.isActive, true),
		}),
		storeIds.length > 0
			? db
					.select({
						storeId: storeHolidayOptout.storeId,
						holidayDefinitionId: storeHolidayOptout.holidayDefinitionId,
					})
					.from(storeHolidayOptout)
					.where(inArray(storeHolidayOptout.storeId, storeIds))
			: Promise.resolve(
					[] as Array<{ storeId: string; holidayDefinitionId: string }>,
				),
	]);

	const optOutsByStore = new Map<string, string[]>();
	for (const row of optOutRows) {
		const list = optOutsByStore.get(row.storeId) ?? [];
		list.push(row.holidayDefinitionId);
		optOutsByStore.set(row.storeId, list);
	}

	const result = new Map<string, OpenStatus>();
	for (const s of stores) {
		const closedDates = resolveStoreClosedDates(
			{
				activeDefs: activeDefs as HolidayDef[],
				optOutIds: optOutsByStore.get(s.id) ?? [],
				customClosures: s.closures ?? [],
			},
			{ from: today, to: windowEnd },
		);
		result.set(
			s.id,
			getOpenStatus({ openingHours: s.openingHours ?? null, closedDates, now }),
		);
	}
	return result;
}
