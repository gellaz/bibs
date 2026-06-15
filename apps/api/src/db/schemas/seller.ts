import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	index,
	pgTable,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { storeEmployee } from "./employee";
import { employeeInvitation } from "./employee-invitation";
import { municipality } from "./location";
import { organization } from "./organization";
import { sellerProfileChange } from "./seller-profile-change";

export const onboardingStatuses = [
	"pending_email",
	"pending_personal",
	"pending_document",
	"pending_company",
	"pending_review",
	"active",
	"rejected",
] as const;
export type OnboardingStatus = (typeof onboardingStatuses)[number];

export const sellerProfile = pgTable(
	"seller_profiles",
	{
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
		residenceMunicipalityId: text("residence_municipality_id").references(
			() => municipality.id,
			{ onDelete: "restrict" },
		),
		residenceAddress: text("residence_address"),
		residenceZipCode: text("residence_zip_code"),

		// ── Documento identità ────────────────────
		documentNumber: text("document_number"),
		documentExpiry: date("document_expiry", { mode: "string" }),
		documentIssuedMunicipalityId: text(
			"document_issued_municipality_id",
		).references(() => municipality.id, { onDelete: "restrict" }),
		documentImageKey: text("document_image_key"),
		documentImageUrl: text("document_image_url"),

		vatChangeBlocked: boolean("vat_change_blocked").default(false).notNull(),
		stripeCustomerId: text("stripe_customer_id").unique(),

		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("seller_profile_onboarding_status_idx").on(table.onboardingStatus),
		index("seller_profile_residence_municipality_idx").on(
			table.residenceMunicipalityId,
		),
		index("seller_profile_document_municipality_idx").on(
			table.documentIssuedMunicipalityId,
		),
		check(
			"seller_profile_onboarding_status_valid",
			sql`${table.onboardingStatus} IN ('pending_email','pending_personal','pending_document','pending_company','pending_review','active','rejected')`,
		),
	],
);

export const sellerProfileRelations = relations(
	sellerProfile,
	({ one, many }) => ({
		user: one(user, {
			fields: [sellerProfile.userId],
			references: [user.id],
		}),
		organization: one(organization),
		residenceMunicipality: one(municipality, {
			fields: [sellerProfile.residenceMunicipalityId],
			references: [municipality.id],
			relationName: "residenceMunicipality",
		}),
		documentIssuedMunicipality: one(municipality, {
			fields: [sellerProfile.documentIssuedMunicipalityId],
			references: [municipality.id],
			relationName: "documentIssuedMunicipality",
		}),
		employees: many(storeEmployee),
		invitations: many(employeeInvitation),
		changes: many(sellerProfileChange),
	}),
);
