import { z } from "zod";
import { zDate } from "./t";

// Gemelli Zod di `lib/schemas/entities.ts` (D3 del piano Hono), con gli stessi
// nomi e nello stesso ordine del file TypeBox: si aggiungono quando una route
// migrata li usa.

// ────────────────────────────────────────────
// Shared types
// ────────────────────────────────────────────

const PointXY = z.object({
	x: z.number().meta({ description: "Longitudine" }),
	y: z.number().meta({ description: "Latitudine" }),
});

// ────────────────────────────────────────────
// Entity schemas
// ────────────────────────────────────────────

export const UserSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
	emailVerified: z.boolean(),
	image: z.string().nullable(),
	createdAt: zDate(),
	updatedAt: zDate(),
	role: z.string().nullable(),
	banned: z.boolean().nullable(),
	banReason: z.string().nullable(),
	banExpires: zDate().nullable(),
});

export const MunicipalityCompactSchema = z
	.object({
		id: z.string().meta({ description: "Identificatore univoco del comune" }),
		name: z.string().meta({ description: "Nome del comune" }),
		provinceAcronym: z
			.string()
			.min(2)
			.max(2)
			.meta({ description: "Sigla provincia (2 lettere)" }),
	})
	.meta({ description: "Comune in formato compatto per liste precaricate" });

export const GeocodeSuggestionSchema = z
	.object({
		label: z.string().meta({
			description: "Riga leggibile, es. 'Via Roma 12, Pioltello (MI)'",
		}),
		addressLine1: z.string().meta({
			description: "Indirizzo con civico, quando il provider lo conosce",
		}),
		zipCode: z
			.string()
			.meta({ description: "CAP, se il provider lo restituisce" })
			.nullable(),
		location: PointXY,
		municipality: MunicipalityCompactSchema.nullable(),
		municipalityCandidates: z.array(MunicipalityCompactSchema).meta({
			description:
				"Comuni omonimi fra cui deve scegliere il cliente quando la risoluzione è incerta",
		}),
		providerRef: z.string().meta({
			description: "Riferimento opaco del provider, usato per il dedup",
		}),
	})
	.meta({ description: "Suggerimento di indirizzo geocodificato" });

export const SellerProfileSchema = z.object({
	id: z.string(),
	userId: z.string(),
	onboardingStatus: z
		.enum([
			"pending_email",
			"pending_personal",
			"pending_document",
			"pending_company",
			"pending_review",
			"active",
			"rejected",
		])
		.meta({ description: "Stato dell'onboarding del venditore" }),
	firstName: z.string().nullable(),
	lastName: z.string().nullable(),
	citizenship: z.string().nullable(),
	birthCountry: z.string().nullable(),
	birthDate: z
		.string()
		.meta({ description: "Data di nascita (YYYY-MM-DD)" })
		.nullable(),
	residenceCountry: z.string().nullable(),
	residenceMunicipalityId: z.string().nullable(),
	residenceMunicipality: MunicipalityCompactSchema.nullable(),
	residenceAddress: z.string().nullable(),
	residenceZipCode: z.string().nullable(),
	documentType: z
		.enum(["identity_card", "driving_license", "passport"])
		.meta({ description: "Tipo di documento d'identità" })
		.nullable(),
	documentNumber: z.string().nullable(),
	documentExpiry: z
		.string()
		.meta({ description: "Scadenza documento (YYYY-MM-DD)" })
		.nullable(),
	documentIssuedMunicipalityId: z.string().nullable(),
	documentIssuedMunicipality: MunicipalityCompactSchema.nullable(),
	documentImageUrl: z.string().nullable(),
	vatChangeBlocked: z.boolean().meta({
		description:
			"Se true, il seller ha una richiesta di cambio P.IVA in attesa e non può ricevere nuovi ordini",
	}),
	rejectionReason: z
		.string()
		.meta({
			description:
				"Motivo dell'ultimo rifiuto della candidatura, azzerato all'approvazione",
		})
		.nullable(),
	createdAt: zDate(),
});

export const OrganizationSchema = z.object({
	id: z.string(),
	sellerProfileId: z.string(),
	businessName: z.string().meta({ description: "Ragione sociale" }),
	vatNumber: z.string().meta({ description: "Partita IVA" }),
	legalForm: z.string().meta({ description: "Forma giuridica" }),
	addressLine1: z.string().meta({ description: "Indirizzo sede legale" }),
	country: z.string().meta({ description: "Codice paese ISO 3166-1 alpha-2" }),
	municipalityId: z.string().meta({ description: "ID comune sede legale" }),
	municipality: MunicipalityCompactSchema,
	zipCode: z.string().meta({ description: "CAP" }),
	vatStatus: z
		.enum(["pending", "verified", "rejected"])
		.meta({ description: "Stato di verifica della partita IVA" }),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const CustomerProfileSchema = z.object({
	id: z.string(),
	userId: z.string(),
	points: z.number().min(0).meta({ description: "Saldo punti fedeltà" }),
	createdAt: zDate(),
});

// ────────────────────────────────────────────
// Location schemas
// ────────────────────────────────────────────

export const CountrySchema = z.object({
	code: z
		.string()
		.min(2)
		.max(2)
		.meta({ description: "Codice ISO 3166-1 alpha-2" }),
	label: z.string().meta({ description: "Nome del paese in italiano" }),
});

export const RegionSchema = z.object({
	id: z.string(),
	name: z.string().meta({ description: "Nome della regione" }),
	istatCode: z.string().meta({ description: "Codice ISTAT della regione" }),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const ProvinceSchema = z.object({
	id: z.string(),
	name: z.string().meta({ description: "Nome della provincia" }),
	acronym: z.string().meta({ description: "Sigla della provincia" }),
	istatCode: z.string().meta({ description: "Codice ISTAT della provincia" }),
	regionId: z.string(),
	createdAt: zDate(),
	updatedAt: zDate(),
});

export const MunicipalitySchema = z.object({
	id: z.string(),
	name: z.string().meta({ description: "Nome del comune" }),
	istatCode: z.string().meta({ description: "Codice ISTAT del comune" }),
	provinceId: z.string(),
	createdAt: zDate(),
	updatedAt: zDate(),
});
