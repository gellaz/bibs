import { Type } from "@sinclair/typebox";
import { CompanyBody, DocumentBody, PersonalInfoBody } from "./onboarding";

// ── Livello 1: Modifica libera ──────────────

// Identical to onboarding's PersonalInfoBody / DocumentBody — re-exported under
// the settings-domain names that the seller settings routes import.
export const PersonalSettingsBody = PersonalInfoBody;
export const DocumentChangeBody = DocumentBody;

// Same as onboarding's CompanyBody minus vatNumber: VAT changes go through the
// admin-approval flow (VatChangeBody) below, not free editing.
export const CompanySettingsBody = Type.Omit(CompanyBody, ["vatNumber"]);

// ── Livello 2: Richiesta approvazione admin ─

export const VatChangeBody = Type.Object({
	vatNumber: Type.String({
		pattern: "^[0-9]{11}$",
		description: "Nuova partita IVA italiana (11 cifre)",
		error: "La partita IVA deve essere di 11 cifre",
	}),
});

export const PaymentChangeBody = Type.Object({
	stripeAccountId: Type.String({
		pattern: "^acct_[a-zA-Z0-9]+$",
		description: "Nuovo ID dell'account Stripe Connect",
		error: "ID account Stripe non valido",
	}),
});
