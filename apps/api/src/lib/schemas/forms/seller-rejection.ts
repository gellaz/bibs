import { Type } from "@sinclair/typebox";

export const SELLER_REJECTION_FIX_STEPS = ["document", "company"] as const;
export type SellerRejectionFixStep =
	(typeof SELLER_REJECTION_FIX_STEPS)[number];

/**
 * Motivi predefiniti del rifiuto di una candidatura venditore. Testo italiano
 * fisso (non paraglide): finisce identico nell'email al venditore anche se
 * l'admin usa l'interfaccia in inglese. `fixStep` null = rifiuto definitivo.
 */
export const SELLER_REJECTION_REASONS: readonly {
	label: string;
	fixStep: SellerRejectionFixStep | null;
}[] = [
	{ label: "Documento illeggibile", fixStep: "document" },
	{ label: "Documento scaduto o non valido", fixStep: "document" },
	{ label: "Dati del documento diversi dalla foto", fixStep: "document" },
	{
		label: "P.IVA non valida o diversa dalla ragione sociale",
		fixStep: "company",
	},
	{ label: "Attività non ammessa su bibs", fixStep: null },
	{ label: "Identità non verificabile", fixStep: null },
];

export const SUPPORT_EMAIL = "supporto@bibs.it";

export const RejectSellerBody = Type.Object({
	reason: Type.String({
		minLength: 1,
		maxLength: 500,
		pattern: "\\S",
		description: "Motivo del rifiuto, mostrato al venditore e nell'email",
		error: "Indica il motivo del rifiuto",
	}),
	fixStep: Type.Union(
		[Type.Literal("document"), Type.Literal("company"), Type.Null()],
		{ description: "Step da correggere; null = rifiuto definitivo" },
	),
});
