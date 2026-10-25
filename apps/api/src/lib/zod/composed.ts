import { z } from "zod";
import {
	CustomerProfileSchema,
	OrganizationSchema,
	SellerProfileSchema,
	UserSchema,
} from "./entities";

// Gemelli Zod di `lib/schemas/composed.ts` (D3 del piano Hono), stessi nomi e
// stesso ordine; si aggiungono quando una route migrata li usa.

// ── Auth: registration / sign-in success payloads ──────────
// These endpoints return RAW DB rows: seller profiles without the joined
// municipality objects, and organizations without the joined municipality.
const RawSellerProfileSchema = SellerProfileSchema.omit({
	residenceMunicipality: true,
	documentIssuedMunicipality: true,
});
const RawOrganizationSchema = OrganizationSchema.omit({ municipality: true });

// `token` may be absent/null when email verification is required (no session).
const AuthToken = z.string().nullable().optional();

export const RegisterCustomerResult = z.object({
	user: UserSchema,
	profile: CustomerProfileSchema,
	token: AuthToken,
});

export const RegisterSellerResult = z.object({
	user: UserSchema,
	profile: RawSellerProfileSchema,
	token: AuthToken,
});

export const SignInResult = z.object({
	user: UserSchema,
	profiles: z.object({
		customer: CustomerProfileSchema.nullable(),
		seller: RawSellerProfileSchema.nullable(),
	}),
	organization: RawOrganizationSchema.nullable(),
	token: AuthToken,
});
