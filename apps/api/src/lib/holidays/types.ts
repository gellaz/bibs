export type HolidayType = "fixed" | "easter_relative" | "one_off";

/** Domain view of a holiday definition (decoupled from the DB row / TypeBox). */
export interface HolidayDef {
	id: string;
	type: HolidayType;
	month: number | null;
	day: number | null;
	easterOffsetDays: number | null;
	oneOffDate: string | null; // "YYYY-MM-DD"
}

export interface CustomClosure {
	startDate: string; // "YYYY-MM-DD"
	endDate?: string | null;
	note?: string | null;
}

export interface OpeningHoursDay {
	dayOfWeek: number; // 0=Mon..6=Sun
	slots: Array<{ open: string; close: string }>; // "HH:mm"
}

export interface OpenStatus {
	isOpen: boolean;
	status: "open" | "closed" | "closed_holiday";
	/** "HH:mm" the store closes today, when currently open. */
	closesAt?: string;
	/** Next opening when currently closed. */
	opensAt?: { date: string; time: string };
}
