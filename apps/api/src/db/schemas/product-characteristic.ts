import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { productCategory } from "./category";
import { product } from "./product";

export const CHARACTERISTIC_DATA_TYPES = [
	"text",
	"number",
	"boolean",
	"enum",
] as const;
export type CharacteristicDataType = (typeof CHARACTERISTIC_DATA_TYPES)[number];

export const productCharacteristic = pgTable(
	"product_characteristics",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		name: text("name").notNull().unique(),
		dataType: text("data_type", { enum: CHARACTERISTIC_DATA_TYPES }).notNull(),
		unit: text("unit"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		check(
			"product_characteristic_data_type_valid",
			sql`${table.dataType} IN ('text','number','boolean','enum')`,
		),
		// L'unità ha senso solo per un numero.
		check(
			"product_characteristic_unit_only_for_number",
			sql`${table.unit} IS NULL OR ${table.dataType} = 'number'`,
		),
		// Bersaglio della chiave esterna composta dei valori: impedisce alla copia
		// denormalizzata di `data_type` di divergere dall'originale.
		unique("product_characteristic_id_data_type_unique").on(
			table.id,
			table.dataType,
		),
	],
);

export const productCharacteristicOption = pgTable(
	"product_characteristic_options",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		characteristicId: text("characteristic_id")
			.notNull()
			.references(() => productCharacteristic.id, { onDelete: "cascade" }),
		value: text("value").notNull(),
		sortOrder: integer("sort_order").notNull(),
	},
	(table) => [
		unique("product_characteristic_option_value_unique").on(
			table.characteristicId,
			table.value,
		),
	],
);

export const productCategoryCharacteristic = pgTable(
	"product_category_characteristics",
	{
		productCategoryId: text("product_category_id")
			.notNull()
			.references(() => productCategory.id, { onDelete: "cascade" }),
		characteristicId: text("characteristic_id")
			.notNull()
			.references(() => productCharacteristic.id, { onDelete: "cascade" }),
		required: boolean("required").default(false).notNull(),
		sortOrder: integer("sort_order").notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.productCategoryId, table.characteristicId],
		}),
		// La chiave primaria ha product_category_id come prefisso sinistro: senza
		// questo, «quali categorie usano questa caratteristica» va in seq scan.
		index("product_category_characteristic_characteristic_id_idx").on(
			table.characteristicId,
		),
	],
);

export const productCharacteristicValue = pgTable(
	"product_characteristic_values",
	{
		productId: text("product_id")
			.notNull()
			.references(() => product.id, { onDelete: "cascade" }),
		characteristicId: text("characteristic_id").notNull(),
		dataType: text("data_type", { enum: CHARACTERISTIC_DATA_TYPES }).notNull(),
		valueText: text("value_text"),
		valueNumber: numeric("value_number", { precision: 14, scale: 4 }),
		valueBoolean: boolean("value_boolean"),
		optionId: text("option_id").references(
			() => productCharacteristicOption.id,
			{ onDelete: "restrict" },
		),
	},
	(table) => [
		primaryKey({ columns: [table.productId, table.characteristicId] }),
		index("product_characteristic_value_characteristic_id_idx").on(
			table.characteristicId,
		),
		// Esattamente la colonna del tipo dichiarato, e solo quella.
		check(
			"product_characteristic_value_matches_data_type",
			sql`(
				CASE WHEN ${table.valueText} IS NOT NULL THEN 1 ELSE 0 END +
				CASE WHEN ${table.valueNumber} IS NOT NULL THEN 1 ELSE 0 END +
				CASE WHEN ${table.valueBoolean} IS NOT NULL THEN 1 ELSE 0 END +
				CASE WHEN ${table.optionId} IS NOT NULL THEN 1 ELSE 0 END
			) = 1 AND (
				(${table.dataType} = 'text' AND ${table.valueText} IS NOT NULL) OR
				(${table.dataType} = 'number' AND ${table.valueNumber} IS NOT NULL) OR
				(${table.dataType} = 'boolean' AND ${table.valueBoolean} IS NOT NULL) OR
				(${table.dataType} = 'enum' AND ${table.optionId} IS NOT NULL)
			)`,
		),
	],
);

export const productCharacteristicRelations = relations(
	productCharacteristic,
	({ many }) => ({
		options: many(productCharacteristicOption),
		categories: many(productCategoryCharacteristic),
	}),
);

export const productCharacteristicOptionRelations = relations(
	productCharacteristicOption,
	({ one }) => ({
		characteristic: one(productCharacteristic, {
			fields: [productCharacteristicOption.characteristicId],
			references: [productCharacteristic.id],
		}),
	}),
);

export const productCategoryCharacteristicRelations = relations(
	productCategoryCharacteristic,
	({ one }) => ({
		category: one(productCategory, {
			fields: [productCategoryCharacteristic.productCategoryId],
			references: [productCategory.id],
		}),
		characteristic: one(productCharacteristic, {
			fields: [productCategoryCharacteristic.characteristicId],
			references: [productCharacteristic.id],
		}),
	}),
);

export const productCharacteristicValueRelations = relations(
	productCharacteristicValue,
	({ one }) => ({
		product: one(product, {
			fields: [productCharacteristicValue.productId],
			references: [product.id],
		}),
		characteristic: one(productCharacteristic, {
			fields: [productCharacteristicValue.characteristicId],
			references: [productCharacteristic.id],
		}),
		option: one(productCharacteristicOption, {
			fields: [productCharacteristicValue.optionId],
			references: [productCharacteristicOption.id],
		}),
	}),
);
