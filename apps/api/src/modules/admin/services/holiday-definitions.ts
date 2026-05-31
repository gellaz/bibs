// apps/api/src/modules/admin/services/holiday-definitions.ts
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { holidayDefinition } from "@/db/schemas/holiday-definition";
import { ServiceError } from "@/lib/errors";
import type { HolidayDef } from "@/lib/holidays";
import { resolveOccurrences } from "@/lib/holidays";

export async function listHolidayDefinitions() {
	return db.query.holidayDefinition.findMany({
		orderBy: asc(holidayDefinition.name),
	});
}

type CreateHolidayInput =
	| { type: "fixed"; name: string; month: number; day: number }
	| { type: "easter_relative"; name: string; easterOffsetDays: number }
	| { type: "one_off"; name: string; oneOffDate: string };

export async function createHolidayDefinition(
	input: CreateHolidayInput,
	createdByUserId: string,
) {
	const [created] = await db
		.insert(holidayDefinition)
		.values({
			name: input.name,
			type: input.type,
			month: input.type === "fixed" ? input.month : null,
			day: input.type === "fixed" ? input.day : null,
			easterOffsetDays:
				input.type === "easter_relative" ? input.easterOffsetDays : null,
			oneOffDate: input.type === "one_off" ? input.oneOffDate : null,
			createdByUserId,
		})
		.returning();
	return created;
}

export async function updateHolidayDefinition(params: {
	id: string;
	name?: string;
	isActive?: boolean;
}) {
	const { id, name, isActive } = params;
	const data: { name?: string; isActive?: boolean } = {};
	if (name !== undefined) data.name = name;
	if (isActive !== undefined) data.isActive = isActive;

	if (Object.keys(data).length === 0) {
		const existing = await db.query.holidayDefinition.findFirst({
			where: eq(holidayDefinition.id, id),
		});
		if (!existing) throw new ServiceError(404, "Holiday definition not found");
		return existing;
	}

	const [updated] = await db
		.update(holidayDefinition)
		.set(data)
		.where(eq(holidayDefinition.id, id))
		.returning();
	if (!updated) throw new ServiceError(404, "Holiday definition not found");
	return updated;
}

export async function deleteHolidayDefinition(id: string) {
	const [deleted] = await db
		.delete(holidayDefinition)
		.where(eq(holidayDefinition.id, id))
		.returning();
	if (!deleted) throw new ServiceError(404, "Holiday definition not found");
	return deleted;
}

export async function previewHolidayYear(year: number) {
	const defs = await db.query.holidayDefinition.findMany({
		where: eq(holidayDefinition.isActive, true),
	});
	const items = defs.flatMap((d) =>
		resolveOccurrences(d as HolidayDef, year, year).map((date) => ({
			definitionId: d.id,
			name: d.name,
			date,
		})),
	);
	items.sort((a, b) => a.date.localeCompare(b.date));
	return items;
}
