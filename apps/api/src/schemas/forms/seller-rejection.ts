import { z } from "zod";
import { zString } from "../t";

export type SellerRejectionFixStep = "document" | "company";

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

export const RejectSellerBody = z.object({
	reason: zString({
		minLength: 1,
		maxLength: 500,
		pattern: "\\S",
		description: "Motivo del rifiuto, mostrato al venditore e nell'email",
		error: "Indica il motivo del rifiuto",
	}),
	fixStep: z
		.union([z.literal("document"), z.literal("company"), z.null()])
		.meta({ description: "Step da correggere; null = rifiuto definitivo" }),
});
