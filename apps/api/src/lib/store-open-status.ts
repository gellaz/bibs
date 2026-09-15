import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { holidayDefinition } from "@/db/schemas/holiday-definition";
import { store } from "@/db/schemas/store";
import { storeHolidayOptout } from "@/db/schemas/store-holiday-optout";
import type {
	CustomClosure,
	HolidayDef,
	OpeningHoursDay,
	OpenStatus,
} from "@/lib/holidays";
import {
	addDaysYMD,
	dowFromYMD,
	getOpenStatus,
	resolveOccurrences,
	resolveStoreClosedDates,
	ymdToYear,
} from "@/lib/holidays";

/** Data e ora correnti a Roma: "YYYY-MM-DD" + "HH:mm". */
function romeNow(now: Date): { date: string; time: string } {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Europe/Rome",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(now);
	const get = (type: string) =>
		parts.find((p) => p.type === type)?.value ?? "00";
	return {
		date: `${get("year")}-${get("month")}-${get("day")}`,
		time: `${get("hour")}:${get("minute")}`,
	};
}

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

/**
 * Condizione SQL "aperto adesso" da mettere nel WHERE di una query su `stores`.
 *
 * Gemella di `getOpenStatus`, che resta la sola implementazione per lo stato
 * mostrato a schermo: qui serve una versione in SQL perché un post-filtro in JS
 * falserebbe `total` e la paginazione. Le parti che il database non sa fare —
 * che ora è a Roma, quali festività cadono oggi — sono risolte prima in JS e
 * scendono nella query come valori, così il SQL resta un confronto fra stringhe.
 *
 * Un negozio è aperto adesso quando: uno slot del giorno corrente copre l'ora
 * corrente, nessuna chiusura personalizzata copre oggi e, se oggi è festivo, il
 * negozio ha esplicitamente rinunciato a quella festività.
 *
 * `customer-store-discovery.test.ts` verifica la parità con `getOpenStatus`:
 * toccando una delle due, esegui quel test.
 */
export async function openNowCondition(now: Date) {
	const { date, time } = romeNow(now);
	const dow = dowFromYMD(date);
	const year = ymdToYear(date);

	const activeDefs = (await db.query.holidayDefinition.findMany({
		where: eq(holidayDefinition.isActive, true),
	})) as HolidayDef[];
	const closedByToday = activeDefs.filter((def) =>
		resolveOccurrences(def, year, year).includes(date),
	);

	const parts = [
		sql`EXISTS (
			SELECT 1
			FROM jsonb_array_elements(${store.openingHours}) AS d,
					 jsonb_array_elements(d->'slots') AS s
			WHERE (d->>'dayOfWeek')::int = ${dow}
				AND (s->>'open')::time <= ${time}::time
				AND (s->>'close')::time > ${time}::time
		)`,
		sql`NOT EXISTS (
			SELECT 1
			FROM jsonb_array_elements(${store.closures}) AS c
			WHERE c->>'startDate' <= ${date}
				AND COALESCE(c->>'endDate', c->>'startDate') >= ${date}
		)`,
	];

	// Di norma zero definizioni, una nei giorni di festa: il negozio resta nei
	// risultati solo se ha l'opt-out per ognuna.
	for (const def of closedByToday) {
		parts.push(sql`EXISTS (
			SELECT 1 FROM ${storeHolidayOptout} o
			WHERE o.store_id = ${store.id}
				AND o.holiday_definition_id = ${def.id}
		)`);
	}

	return sql`(${sql.join(parts, sql` AND `)})`;
}
