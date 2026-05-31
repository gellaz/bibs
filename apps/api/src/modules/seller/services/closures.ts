import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { holidayDefinition } from "@/db/schemas/holiday-definition";
import { store as storeTable } from "@/db/schemas/store";
import { storeHolidayOptout } from "@/db/schemas/store-holiday-optout";
import { ServiceError } from "@/lib/errors";
import type { CustomClosure, HolidayDef } from "@/lib/holidays";
import { resolveOccurrences } from "@/lib/holidays";

async function loadOwnedStore(storeId: string, sellerProfileId: string) {
	const s = await db.query.store.findFirst({
		where: and(
			eq(storeTable.id, storeId),
			eq(storeTable.sellerProfileId, sellerProfileId),
			isNull(storeTable.deletedAt),
		),
	});
	if (!s) throw new ServiceError(404, "Store not found");
	return s;
}

/** First occurrence today-or-later (Europe/Rome), looking up to 3 years out. */
function nextOccurrence(def: HolidayDef): string | null {
	const today = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Rome",
	}).format(new Date());
	const year = Number(today.slice(0, 4));
	const dates = resolveOccurrences(def, year, year + 2)
		.filter((d) => d >= today)
		.sort();
	return dates[0] ?? null;
}

async function buildClosuresState(storeRow: { id: string; closures: unknown }) {
	const [defs, optOuts] = await Promise.all([
		db.query.holidayDefinition.findMany({
			where: eq(holidayDefinition.isActive, true),
		}),
		db
			.select({ id: storeHolidayOptout.holidayDefinitionId })
			.from(storeHolidayOptout)
			.where(eq(storeHolidayOptout.storeId, storeRow.id)),
	]);
	const optedOut = new Set(optOuts.map((o) => o.id));

	const holidays = defs
		.map((d) => ({
			definitionId: d.id,
			name: d.name,
			type: d.type,
			nextDate: nextOccurrence(d as HolidayDef),
			observed: !optedOut.has(d.id),
		}))
		.sort((a, b) =>
			(a.nextDate ?? "9999-99-99").localeCompare(b.nextDate ?? "9999-99-99"),
		);

	return {
		holidays,
		customClosures: (storeRow.closures as CustomClosure[] | null) ?? [],
	};
}

export async function getStoreClosures(
	storeId: string,
	sellerProfileId: string,
) {
	const storeRow = await loadOwnedStore(storeId, sellerProfileId);
	return buildClosuresState(storeRow);
}

export async function putStoreClosures(params: {
	storeId: string;
	sellerProfileId: string;
	optOutIds: string[];
	customClosures: CustomClosure[];
}) {
	const { storeId, sellerProfileId, optOutIds, customClosures } = params;
	await loadOwnedStore(storeId, sellerProfileId);

	for (const c of customClosures) {
		if (c.endDate && c.endDate < c.startDate) {
			throw new ServiceError(
				400,
				"Intervallo chiusura non valido: la data di fine precede l'inizio",
			);
		}
	}

	const uniqueOptOuts = [...new Set(optOutIds)];
	if (uniqueOptOuts.length > 0) {
		const existing = await db
			.select({ id: holidayDefinition.id })
			.from(holidayDefinition)
			.where(inArray(holidayDefinition.id, uniqueOptOuts));
		if (existing.length !== uniqueOptOuts.length) {
			throw new ServiceError(400, "Uno o più ID festività non sono validi");
		}
	}

	await db.transaction(async (tx) => {
		await tx
			.delete(storeHolidayOptout)
			.where(eq(storeHolidayOptout.storeId, storeId));
		if (uniqueOptOuts.length > 0) {
			await tx.insert(storeHolidayOptout).values(
				uniqueOptOuts.map((holidayDefinitionId) => ({
					storeId,
					holidayDefinitionId,
				})),
			);
		}
		await tx
			.update(storeTable)
			.set({ closures: customClosures.length > 0 ? customClosures : null })
			.where(eq(storeTable.id, storeId));
	});

	return getStoreClosures(storeId, sellerProfileId);
}
