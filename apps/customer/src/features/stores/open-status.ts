import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { Clock, HelpCircle, type LucideIcon } from "lucide-react";
import { m } from "@/paraglide/messages";

export interface OpenStatusView {
	isOpen: boolean;
	status: "open" | "closed" | "closed_holiday" | "unknown";
	closesAt?: string;
	opensAt?: { date: string; time: string };
}

/** "apre alle 09:00" / "apre domani alle 09:00" / "apre mar 24 giu alle 09:00". */
export function describeOpensAt(opensAt: {
	date: string;
	time: string;
}): string {
	const todayRome = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Europe/Rome",
	}).format(new Date());
	const base = new Date(`${todayRome}T00:00:00`);
	const tomorrow = new Date(base);
	tomorrow.setDate(base.getDate() + 1);
	const fmt = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	if (opensAt.date === todayRome) return m.opens_today({ time: opensAt.time });
	if (opensAt.date === fmt(tomorrow))
		return m.opens_tomorrow({ time: opensAt.time });
	const d = new Date(`${opensAt.date}T00:00:00`);
	const day = new Intl.DateTimeFormat(intlLocale(), {
		weekday: "short",
		day: "numeric",
		month: "short",
	}).format(d);
	return m.opens_on({ day, time: opensAt.time });
}

/** "Aperto · chiude alle 19:30" / "Aperto" / "Chiuso · apre …" / "Chiuso" / "Orari non indicati". */
export function openStatusLabel(status: OpenStatusView): string {
	// Senza orari dichiarati non possiamo dire né aperto né chiuso. Prima di
	// `isOpen`, che per questo stato è `false` e porterebbe a "Chiuso".
	if (status.status === "unknown") return m.open_status_unknown();
	if (status.isOpen) {
		return status.closesAt
			? m.open_status_open_closes({ time: status.closesAt })
			: m.open_status_open();
	}
	if (status.opensAt)
		return m.open_status_closed_opens({
			opens: describeOpensAt(status.opensAt),
		});
	return m.open_status_closed();
}

/**
 * L'icona porta la distinzione: l'orologio è di chi un orario ce l'ha, il punto
 * interrogativo di chi non l'ha mai dichiarato.
 */
export function openStatusIcon(status: OpenStatusView): LucideIcon {
	return status.status === "unknown" ? HelpCircle : Clock;
}
