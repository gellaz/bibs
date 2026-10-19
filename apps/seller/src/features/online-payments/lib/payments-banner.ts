export type OnlinePaymentsStatus =
	| "none"
	| "incomplete"
	| "in_review"
	| "enabled";
export type BannerStatus = Exclude<OnlinePaymentsStatus, "enabled">;
export type Dismissed = { status: OnlinePaymentsStatus; at: number };

export const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
export const DISMISS_KEY = "bibs:payments-banner-dismissed";

const STATUSES: readonly OnlinePaymentsStatus[] = [
	"none",
	"incomplete",
	"in_review",
	"enabled",
];

/**
 * Quale banner dei pagamenti online mostrare, o null. Sparisce con i pagamenti
 * attivi e sulla scheda Vendita (lì c'è il riquadro con lo stesso pulsante);
 * chiuso con la X resta via 7 giorni, ma torna subito se lo stato cambia.
 */
export function visibleBanner({
	status,
	dismissed,
	now,
	onSalesTab,
}: {
	status: OnlinePaymentsStatus | undefined;
	dismissed: Dismissed | null;
	now: number;
	onSalesTab: boolean;
}): BannerStatus | null {
	if (!status || status === "enabled" || onSalesTab) return null;
	if (dismissed?.status === status && now - dismissed.at < DISMISS_MS)
		return null;
	return status;
}

// Lo storage può mancare o lanciare (navigazione privata, dati bloccati):
// in quel caso il banner si vede, come se non fosse mai stato chiuso.
export function readDismissed(): Dismissed | null {
	try {
		const raw = localStorage.getItem(DISMISS_KEY);
		if (!raw) return null;
		const v = JSON.parse(raw) as Partial<Dismissed>;
		return STATUSES.includes(v.status as OnlinePaymentsStatus) &&
			typeof v.at === "number"
			? { status: v.status as OnlinePaymentsStatus, at: v.at }
			: null;
	} catch {
		return null;
	}
}

export function writeDismissed(d: Dismissed): void {
	try {
		localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
	} catch {}
}
