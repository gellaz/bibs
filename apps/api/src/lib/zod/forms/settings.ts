import { z } from "zod";
import { CompanyBody, DocumentBody, PersonalInfoBody } from "./onboarding";

// Gemelli Zod di `lib/schemas/forms/settings.ts` (D3 del piano Hono).

// ── Livello 1: Modifica libera ──────────────

export const PersonalSettingsBody = PersonalInfoBody;
export const DocumentChangeBody = DocumentBody;

// La partita IVA si cambia solo con la richiesta all'admin (VatChangeBody).
export const CompanySettingsBody = CompanyBody.omit({ vatNumber: true });

// ── Livello 2: Richiesta approvazione admin ─

export const VatChangeBody = z.object({
	vatNumber: z
		.string()
		.regex(/^[0-9]{11}$/)
		.meta({
			description: "Nuova partita IVA italiana (11 cifre)",
			error: "La partita IVA deve essere di 11 cifre",
		}),
});
