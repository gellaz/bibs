export interface OpenStatusView {
	isOpen: boolean;
	status: "open" | "closed" | "closed_holiday";
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
	if (opensAt.date === todayRome) return `apre alle ${opensAt.time}`;
	if (opensAt.date === fmt(tomorrow)) return `apre domani alle ${opensAt.time}`;
	const d = new Date(`${opensAt.date}T00:00:00`);
	const label = new Intl.DateTimeFormat("it-IT", {
		weekday: "short",
		day: "numeric",
		month: "short",
	}).format(d);
	return `apre ${label} alle ${opensAt.time}`;
}

/** "Aperto · chiude alle 19:30" / "Chiuso · apre …" / "Aperto" / "Chiuso". */
export function openStatusLabel(status: OpenStatusView): string {
	if (status.isOpen) {
		return status.closesAt
			? `Aperto · chiude alle ${status.closesAt}`
			: "Aperto";
	}
	if (status.opensAt) return `Chiuso · ${describeOpensAt(status.opensAt)}`;
	return "Chiuso";
}
