import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const region = pgTable("regions", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text("name").notNull().unique(),
	istatCode: varchar("istat_code", { length: 2 }).notNull().unique(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});

export const province = pgTable(
	"provinces",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull().unique(),
		acronym: varchar("acronym", { length: 2 }).notNull().unique(),
		istatCode: varchar("istat_code", { length: 3 }).notNull().unique(),
		regionId: text("region_id")
			.notNull()
			.references(() => region.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [index("province_region_id_idx").on(t.regionId)],
);

export const municipality = pgTable(
	"municipalities",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull(),
		istatCode: varchar("istat_code", { length: 6 }).notNull().unique(),
		provinceId: text("province_id")
			.notNull()
			.references(() => province.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [index("municipality_province_id_idx").on(t.provinceId)],
);

// ── Relations ───────────────────────────────

export const regionRelations = relations(region, ({ many }) => ({
	provinces: many(province),
}));

export const provinceRelations = relations(province, ({ one, many }) => ({
	region: one(region, {
		fields: [province.regionId],
		references: [region.id],
	}),
	municipalities: many(municipality),
}));

export const municipalityRelations = relations(municipality, ({ one }) => ({
	province: one(province, {
		fields: [municipality.provinceId],
		references: [province.id],
	}),
}));
