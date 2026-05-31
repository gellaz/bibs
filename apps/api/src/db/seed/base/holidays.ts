import { count } from "drizzle-orm";
import { db } from "@/db";
import { holidayDefinition } from "@/db/schemas/holiday-definition";

type DefaultHoliday =
	| { name: string; type: "fixed"; month: number; day: number }
	| { name: string; type: "easter_relative"; easterOffsetDays: number };

const DEFAULT_HOLIDAYS: DefaultHoliday[] = [
	{ name: "Capodanno", type: "fixed", month: 1, day: 1 },
	{ name: "Epifania", type: "fixed", month: 1, day: 6 },
	{ name: "Pasqua", type: "easter_relative", easterOffsetDays: 0 },
	{ name: "Lunedì dell'Angelo", type: "easter_relative", easterOffsetDays: 1 },
	{ name: "Festa della Liberazione", type: "fixed", month: 4, day: 25 },
	{ name: "Festa del Lavoro", type: "fixed", month: 5, day: 1 },
	{ name: "Festa della Repubblica", type: "fixed", month: 6, day: 2 },
	{ name: "Ferragosto", type: "fixed", month: 8, day: 15 },
	{ name: "Tutti i Santi", type: "fixed", month: 11, day: 1 },
	{ name: "Immacolata Concezione", type: "fixed", month: 12, day: 8 },
	{ name: "Natale", type: "fixed", month: 12, day: 25 },
	{ name: "Santo Stefano", type: "fixed", month: 12, day: 26 },
];

export async function seedHolidayDefinitions() {
	const [{ total }] = await db
		.select({ total: count() })
		.from(holidayDefinition);
	if (total > 0) {
		console.log("  ⏭ Holiday definitions already seeded, skipping");
		return;
	}

	console.log("  📅 Seeding default Italian holidays...");
	await db.insert(holidayDefinition).values(
		DEFAULT_HOLIDAYS.map((h) => ({
			name: h.name,
			type: h.type,
			month: h.type === "fixed" ? h.month : null,
			day: h.type === "fixed" ? h.day : null,
			easterOffsetDays:
				h.type === "easter_relative" ? h.easterOffsetDays : null,
		})),
	);
	console.log(`     ✓ ${DEFAULT_HOLIDAYS.length} holiday definitions`);
}
