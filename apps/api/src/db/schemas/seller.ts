import { relations } from "drizzle-orm";
import { date, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { storeEmployee } from "./employee";
import { organization } from "./organization";

export const onboardingStatuses = [
	"pending_email",
	"pending_personal",
	"pending_document",
	"pending_company",
	"pending_store",
	"pending_payment",
	"pending_review",
	"active",
	"rejected",
] as const;
export type OnboardingStatus = (typeof onboardingStatuses)[number];

export const sellerProfile = pgTable("seller_profiles", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" })
		.unique(),
	onboardingStatus: varchar("onboarding_status", {
		enum: onboardingStatuses,
	})
		.default("pending_email")
		.notNull(),

	// ── Anagrafica ────────────────────────────
	firstName: text("first_name"),
	lastName: text("last_name"),
	citizenship: text("citizenship"),
	birthCountry: text("birth_country"),
	birthDate: date("birth_date", { mode: "string" }),
	residenceCountry: text("residence_country"),
	residenceCity: text("residence_city"),
	residenceAddress: text("residence_address"),
	residenceZipCode: text("residence_zip_code"),

	// ── Documento identità ────────────────────
	documentNumber: text("document_number"),
	documentExpiry: date("document_expiry", { mode: "string" }),
	documentIssuedMunicipality: text("document_issued_municipality"),
	documentImageKey: text("document_image_key"),
	documentImageUrl: text("document_image_url"),

	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const sellerProfileRelations = relations(
	sellerProfile,
	({ one, many }) => ({
		user: one(user, {
			fields: [sellerProfile.userId],
			references: [user.id],
		}),
		organization: one(organization),
		employees: many(storeEmployee),
	}),
);
