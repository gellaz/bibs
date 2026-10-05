import { m } from "@/paraglide/messages";

// Il valore salvato resta in italiano (è il dato); l'etichetta segue la lingua.
export const LEGAL_FORMS: { value: string; label: () => string }[] = [
	{ value: "Ditta individuale", label: m.onboarding_legal_form_sole_trader },
	{ value: "SRL", label: () => "SRL" },
	{ value: "SRLS", label: () => "SRLS" },
	{ value: "SAS", label: () => "SAS" },
	{ value: "SNC", label: () => "SNC" },
	{ value: "SPA", label: () => "SPA" },
	{ value: "Cooperativa", label: m.onboarding_legal_form_cooperative },
	{ value: "Associazione", label: m.onboarding_legal_form_association },
	{ value: "Altro", label: m.onboarding_legal_form_other },
];
