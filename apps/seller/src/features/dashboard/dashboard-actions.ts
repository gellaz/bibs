import { toYMD } from "@bibs/ui/lib/date";
import { m } from "@/paraglide/messages";

export type Urgency = "high" | "medium" | "low";

export type ActionKind =
	| "location"
	| "orders"
	| "out-of-stock"
	| "low-stock"
	| "promo"
	| "hours";

export type ActionHref =
	| "/store"
	| "/store/closures"
	| "/orders"
	| "/products"
	| "/promotions";

export interface ActionItem {
	id: string;
	kind: ActionKind;
	urgency: Urgency;
	title: string;
	subtitle: string;
	href: ActionHref;
}

/** Stato di apertura come lo restituisce l'API (`openStatus` di /seller/stores). */
export interface OpenStatusLike {
	isOpen: boolean;
	status: "open" | "closed" | "closed_holiday" | "unknown";
	// Eden idrata le date ISO in Date anche dove lo schema dice stringa.
	opensAt?: { date: string | Date; time: string };
}

/** La parte `actions` di GET /seller/dashboard. */
export interface DashboardActionsData {
	ordersToPrepare: { count: number; oldestCreatedAt: Date | null };
	outOfStock: { count: number; sampleNames: string[] };
	lowStock: { count: number; threshold: number };
	expiringPromotions: {
		count: number;
		first: { name: string; endsAt: Date } | null;
	};
}

const URGENCY_RANK: Record<Urgency, number> = { high: 0, medium: 1, low: 2 };

/** high → medium → low; a parità di urgenza resta l'ordine di arrivo. */
export function sortByUrgency<T extends { urgency: Urgency }>(items: T[]): T[] {
	return items
		.map((item, i) => ({ item, i }))
		.sort(
			(a, b) =>
				URGENCY_RANK[a.item.urgency] - URGENCY_RANK[b.item.urgency] ||
				a.i - b.i,
		)
		.map(({ item }) => item);
}

/**
 * Avviso sugli orari del negozio, o null. Tre esiti: orari mai impostati
 * (profilo incompleto, il negozio sparisce da «Aperti ora»), chiuso per
 * festività/chiusura, chiuso adesso. Aperto → nessun avviso: il seller non
 * vede un «Aperto adesso» generico.
 */
export function hoursAction(
	openStatus: OpenStatusLike | null | undefined,
	isOwner = true,
): ActionItem | null {
	if (!openStatus) return null;
	// Le chiusure sono solo del titolare (l'API risponde 403 al dipendente):
	// il dipendente va alla scheda negozio, in sola lettura.
	const closuresHref = isOwner ? "/store/closures" : "/store";

	if (openStatus.status === "unknown") {
		return {
			id: "hours-missing",
			kind: "hours",
			urgency: "medium",
			title: m.dashboard_hours_missing_title(),
			subtitle: m.dashboard_hours_missing_subtitle(),
			href: "/store",
		};
	}

	if (openStatus.isOpen) return null;

	if (openStatus.status === "closed_holiday") {
		return {
			id: "hours-status",
			kind: "hours",
			urgency: "medium",
			title: m.dashboard_hours_holiday_title(),
			subtitle: m.dashboard_hours_holiday_subtitle(),
			href: closuresHref,
		};
	}

	return {
		id: "hours-status",
		kind: "hours",
		urgency: "low",
		title: m.dashboard_hours_closed_title(),
		subtitle: openStatus.opensAt
			? m.dashboard_hours_reopens({
					date: toYMD(openStatus.opensAt.date),
					time: openStatus.opensAt.time,
				})
			: m.dashboard_hours_no_reopening(),
		href: closuresHref,
	};
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RELATIVE = new Intl.RelativeTimeFormat("it-IT", { numeric: "always" });

/**
 * Distanza relativa in italiano ("38 minuti fa", "tra 2 giorni"): minuti
 * sotto l'ora, ore sotto il giorno, poi giorni. Mai sotto il minuto, così un
 * ordine appena arrivato non diventa "0 minuti fa".
 */
export function formatRelative(target: Date, now: Date): string {
	const diff = target.getTime() - now.getTime();
	const abs = Math.abs(diff);
	const sign = diff < 0 ? -1 : 1;
	if (abs < HOUR) {
		return RELATIVE.format(
			sign * Math.max(1, Math.round(abs / MINUTE)),
			"minute",
		);
	}
	if (abs < DAY) return RELATIVE.format(sign * Math.round(abs / HOUR), "hour");
	return RELATIVE.format(sign * Math.round(abs / DAY), "day");
}

function ordersAction(
	d: DashboardActionsData["ordersToPrepare"],
	now: Date,
): ActionItem | null {
	if (d.count <= 0) return null;
	const age = d.oldestCreatedAt ? formatRelative(d.oldestCreatedAt, now) : null;
	return {
		id: "orders-to-prepare",
		kind: "orders",
		urgency: "high",
		title:
			d.count === 1
				? m.dashboard_orders_to_prepare_one()
				: m.dashboard_orders_to_prepare_other({ count: d.count }),
		subtitle: age
			? d.count === 1
				? m.dashboard_orders_to_prepare_subtitle_one({ age })
				: m.dashboard_orders_to_prepare_subtitle_other({ age })
			: "",
		href: "/orders",
	};
}

function outOfStockAction(
	d: DashboardActionsData["outOfStock"],
): ActionItem | null {
	if (d.count <= 0) return null;
	const names = d.sampleNames.join(" · ");
	const rest = d.count - d.sampleNames.length;
	return {
		id: "out-of-stock",
		kind: "out-of-stock",
		urgency: "high",
		title:
			d.count === 1
				? m.dashboard_out_of_stock_one()
				: m.dashboard_out_of_stock_other({ count: d.count }),
		subtitle:
			rest > 0 && names
				? m.dashboard_out_of_stock_more({ names, count: rest })
				: names,
		href: "/products",
	};
}

function lowStockAction(
	d: DashboardActionsData["lowStock"],
): ActionItem | null {
	if (d.count <= 0) return null;
	return {
		id: "low-stock",
		kind: "low-stock",
		urgency: "medium",
		title:
			d.count === 1
				? m.dashboard_low_stock_one()
				: m.dashboard_low_stock_other({ count: d.count }),
		subtitle: m.dashboard_low_stock_subtitle({ threshold: d.threshold }),
		href: "/products",
	};
}

function promoAction(
	d: DashboardActionsData["expiringPromotions"],
	now: Date,
): ActionItem | null {
	if (d.count <= 0 || !d.first) return null;
	const when = formatRelative(d.first.endsAt, now);
	const name = d.first.name;
	return {
		id: "promo-expiring",
		kind: "promo",
		urgency: "medium",
		title:
			d.count === 1
				? m.dashboard_promo_expiring_one({ name, when })
				: m.dashboard_promo_expiring_other({ count: d.count }),
		subtitle:
			d.count === 1
				? m.dashboard_promo_expiring_subtitle_one()
				: m.dashboard_promo_expiring_subtitle_other({ name, when }),
		href: "/promotions",
	};
}

export interface BuildActionsInput {
	/** null finché il riepilogo non è arrivato (o se è fallito). */
	dashboard: DashboardActionsData | null;
	/** true solo se il negozio è caricato e non ha coordinate. */
	locationMissing: boolean;
	openStatus: OpenStatusLike | null | undefined;
	/** Il dipendente non gestisce le chiusure. Default: titolare. */
	isOwner?: boolean;
	now: Date;
}

/**
 * Tutte le voci «Da gestire oggi», solo quelle con qualcosa da fare,
 * ordinate per urgenza.
 */
export function buildDashboardActions(input: BuildActionsInput): ActionItem[] {
	const { dashboard: d, now } = input;
	const items: (ActionItem | null)[] = [
		// Senza coordinate nessuno trova il negozio cercando vicino a sé: è il
		// profilo incompleto con la conseguenza più grave.
		input.locationMissing
			? {
					id: "location-missing",
					kind: "location",
					urgency: "high",
					title: m.dashboard_location_missing_title(),
					subtitle: m.dashboard_location_missing_subtitle(),
					href: "/store",
				}
			: null,
		d ? ordersAction(d.ordersToPrepare, now) : null,
		d ? outOfStockAction(d.outOfStock) : null,
		d ? lowStockAction(d.lowStock) : null,
		d ? promoAction(d.expiringPromotions, now) : null,
		hoursAction(input.openStatus, input.isOwner),
	];
	return sortByUrgency(items.filter((a): a is ActionItem => a !== null));
}

const TODAY_FORMAT = new Intl.DateTimeFormat("it-IT", {
	weekday: "long",
	day: "numeric",
	month: "long",
	timeZone: "Europe/Rome",
});

/** "Lunedì 28 settembre": la data di oggi a Roma, con l'iniziale maiuscola. */
export function formatTodayLabel(now: Date): string {
	const label = TODAY_FORMAT.format(now);
	return label.charAt(0).toUpperCase() + label.slice(1);
}
