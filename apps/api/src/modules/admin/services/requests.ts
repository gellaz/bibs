import type { Static } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sellerProfile } from "@/db/schemas/seller";
import { sellerProfileChange } from "@/db/schemas/seller-profile-change";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";
import type { DocumentChangeBody } from "@/lib/schemas/forms";

export type RequestType = "all" | "candidature" | "vat" | "document";

type DocumentChangeData = Static<typeof DocumentChangeBody> & {
	documentImageUrl?: string;
};

const municipalityWith = {
	columns: { name: true },
	with: { province: { columns: { acronym: true } } },
} as const;

const candidates = () =>
	db.query.sellerProfile.findMany({
		where: eq(sellerProfile.onboardingStatus, "pending_review"),
		with: { user: true, organization: true },
	});

const pendingChanges = () =>
	db.query.sellerProfileChange.findMany({
		where: eq(sellerProfileChange.status, "pending"),
		with: {
			sellerProfile: {
				with: {
					user: true,
					organization: true,
					documentIssuedMunicipality: municipalityWith,
				},
			},
		},
	});

const DOCUMENT_TYPE_IT = {
	identity_card: "Carta d'identità",
	driving_license: "Patente",
	passport: "Passaporto",
} as const;

/** «Patente 123»: il tipo e il numero del documento, per la colonna «Cosa cambia». */
const docLabel = (type: string | null, number: string | null) =>
	[type && (DOCUMENT_TYPE_IT as Record<string, string>)[type], number]
		.filter(Boolean)
		.join(" ") || null;

async function listAllRequests() {
	const [profiles, changes] = await Promise.all([
		candidates(),
		pendingChanges(),
	]);

	const rows = [
		...profiles.map((p) => ({
			kind: "candidature" as const,
			id: p.id,
			sellerProfileId: p.id,
			seller: { name: p.user.name, email: p.user.email },
			businessName: p.organization?.businessName ?? null,
			currentValue: null,
			requestedValue: null,
			submittedAt: p.updatedAt,
		})),
		...changes.map((c) => {
			const sp = c.sellerProfile;
			const isVat = c.changeType === "vat";
			return {
				kind: c.changeType,
				id: c.id,
				sellerProfileId: sp.id,
				seller: { name: sp.user.name, email: sp.user.email },
				businessName: sp.organization?.businessName ?? null,
				currentValue: isVat
					? (sp.organization?.vatNumber ?? null)
					: docLabel(sp.documentType, sp.documentNumber),
				requestedValue: isVat
					? (c.changeData as { vatNumber: string }).vatNumber
					: docLabel(
							(c.changeData as DocumentChangeData).documentType,
							(c.changeData as DocumentChangeData).documentNumber,
						),
				submittedAt: c.createdAt,
			};
		}),
	];
	return rows.sort(
		(a, b) =>
			a.submittedAt.getTime() - b.submittedAt.getTime() ||
			a.id.localeCompare(b.id),
	);
}

export async function listRequests(params: {
	type?: RequestType;
	page?: number;
	limit?: number;
}) {
	const { page, limit, offset } = parsePagination(params);
	// ponytail: carica tutte le richieste in attesa e pagina in memoria; va bene
	// fino a qualche centinaio, oltre serve una UNION in SQL.
	const all = await listAllRequests();
	const type = params.type ?? "all";
	const filtered = type === "all" ? all : all.filter((r) => r.kind === type);
	return {
		data: filtered.slice(offset, offset + limit),
		pagination: { page, limit, total: filtered.length },
	};
}

export async function countRequests() {
	const all = await listAllRequests();
	const of = (kind: string) => all.filter((r) => r.kind === kind).length;
	return {
		total: all.length,
		candidature: of("candidature"),
		vat: of("vat"),
		document: of("document"),
	};
}

export async function getChangeDetail(changeId: string) {
	const change = await db.query.sellerProfileChange.findFirst({
		where: and(eq(sellerProfileChange.id, changeId)),
		with: {
			sellerProfile: {
				with: {
					user: true,
					organization: true,
					documentIssuedMunicipality: municipalityWith,
				},
			},
		},
	});
	if (!change) throw new ServiceError(404, "Richiesta di modifica non trovata");

	const sp = change.sellerProfile;
	const base = {
		id: change.id,
		changeType: change.changeType,
		status: change.status,
		createdAt: change.createdAt,
		seller: {
			id: sp.id,
			name: sp.user.name,
			email: sp.user.email,
			businessName: sp.organization?.businessName ?? null,
		},
	};

	if (change.changeType === "vat") {
		return {
			...base,
			vat: {
				current: sp.organization?.vatNumber ?? null,
				requested: (change.changeData as { vatNumber: string }).vatNumber,
			},
			document: null,
		};
	}

	const req = change.changeData as DocumentChangeData;
	const requestedMunicipality = await db.query.municipality.findFirst({
		where: (m, { eq }) => eq(m.id, req.documentIssuedMunicipalityId),
		...municipalityWith,
	});
	const toMunicipality = (
		m: { name: string; province: { acronym: string } } | null | undefined,
	) => (m ? { name: m.name, provinceAcronym: m.province.acronym } : null);

	return {
		...base,
		vat: null,
		document: {
			current: {
				documentType: sp.documentType,
				documentNumber: sp.documentNumber,
				documentExpiry: sp.documentExpiry,
				issuedMunicipality: toMunicipality(sp.documentIssuedMunicipality),
				imageUrl: sp.documentImageUrl,
			},
			requested: {
				documentType: req.documentType,
				documentNumber: req.documentNumber,
				documentExpiry: req.documentExpiry,
				issuedMunicipality: toMunicipality(requestedMunicipality),
				// Senza foto nuova l'approvazione non cambia quella attuale.
				// Rifiutata o annullata: la foto nuova è stata cancellata.
				imageUrl:
					change.status === "pending"
						? (req.documentImageUrl ?? sp.documentImageUrl)
						: null,
			},
		},
	};
}
