import { Type } from "@sinclair/typebox";

// ── Step 1: Personal Info ───────────────────

export const PersonalInfoBody = Type.Object({
	firstName: Type.String({
		minLength: 1,
		maxLength: 100,
		description: "Nome",
		error: "Il nome è obbligatorio",
	}),
	lastName: Type.String({
		minLength: 1,
		maxLength: 100,
		description: "Cognome",
		error: "Il cognome è obbligatorio",
	}),
	citizenship: Type.String({
		minLength: 2,
		maxLength: 2,
		description: "Cittadinanza (codice ISO alpha-2)",
		error: "Seleziona la cittadinanza",
	}),
	birthCountry: Type.String({
		minLength: 2,
		maxLength: 2,
		description: "Paese di nascita (codice ISO alpha-2)",
		error: "Seleziona il paese di nascita",
	}),
	birthDate: Type.String({
		pattern: "^\\d{4}-\\d{2}-\\d{2}$",
		description: "Data di nascita (YYYY-MM-DD)",
		error: "Formato data non valido (AAAA-MM-GG)",
	}),
	residenceCountry: Type.String({
		minLength: 2,
		maxLength: 2,
		description: "Paese di residenza (codice ISO alpha-2)",
		error: "Seleziona il paese di residenza",
	}),
	residenceCity: Type.String({
		minLength: 1,
		maxLength: 100,
		description: "Città di residenza",
		error: "La città di residenza è obbligatoria",
	}),
	residenceAddress: Type.String({
		minLength: 1,
		maxLength: 200,
		description: "Indirizzo di residenza",
		error: "L'indirizzo di residenza è obbligatorio",
	}),
	residenceZipCode: Type.String({
		pattern: "^\\d{5}$",
		description: "CAP residenza (5 cifre)",
		error: "Il CAP deve essere di 5 cifre",
	}),
});

// ── Step 2: Document ────────────────────────
// Note: documentImage (t.File) is NOT included here — it's added
// in the route definition since File is a server-only concept.

export const DocumentBody = Type.Object({
	documentNumber: Type.String({
		minLength: 5,
		maxLength: 20,
		description: "Numero carta d'identità",
		error: "Il numero del documento deve avere tra 5 e 20 caratteri",
	}),
	documentExpiry: Type.String({
		pattern: "^\\d{4}-\\d{2}-\\d{2}$",
		description: "Scadenza documento (YYYY-MM-DD)",
		error: "Formato data non valido (AAAA-MM-GG)",
	}),
	documentIssuedMunicipality: Type.String({
		minLength: 1,
		maxLength: 100,
		description: "Comune di rilascio",
		error: "Il comune di rilascio è obbligatorio",
	}),
});

// ── Step 3: Company ─────────────────────────

export const CompanyBody = Type.Object({
	businessName: Type.String({
		minLength: 1,
		maxLength: 200,
		description: "Ragione sociale",
		error: "La ragione sociale è obbligatoria",
	}),
	vatNumber: Type.String({
		pattern: "^[0-9]{11}$",
		description: "Partita IVA italiana (11 cifre)",
		error: "La partita IVA deve essere di 11 cifre",
	}),
	legalForm: Type.String({
		minLength: 1,
		maxLength: 100,
		description: "Forma giuridica (es. SRL, SAS, Ditta individuale)",
		error: "La forma giuridica è obbligatoria",
	}),
	addressLine1: Type.String({
		minLength: 1,
		maxLength: 200,
		description: "Indirizzo sede legale",
		error: "L'indirizzo è obbligatorio",
	}),
	country: Type.Optional(
		Type.String({
			minLength: 2,
			maxLength: 2,
			description: "Codice paese ISO alpha-2 (default: IT)",
		}),
	),
	province: Type.Optional(
		Type.String({
			minLength: 2,
			maxLength: 5,
			description: "Provincia (sigla)",
		}),
	),
	city: Type.String({
		minLength: 1,
		maxLength: 100,
		description: "Città",
		error: "La città è obbligatoria",
	}),
	zipCode: Type.String({
		pattern: "^\\d{5}$",
		description: "CAP (5 cifre)",
		error: "Il CAP deve essere di 5 cifre",
	}),
});

// ── Step 4: Store ───────────────────────────

export const OnboardingStoreBody = Type.Object({
	name: Type.String({
		minLength: 1,
		maxLength: 100,
		description: "Nome del negozio",
		error: "Il nome del negozio è obbligatorio",
	}),
	description: Type.Optional(
		Type.String({
			maxLength: 1000,
			description: "Descrizione del negozio",
		}),
	),
	addressLine1: Type.String({
		minLength: 1,
		maxLength: 200,
		description: "Indirizzo negozio",
		error: "L'indirizzo è obbligatorio",
	}),
	province: Type.Optional(
		Type.String({
			minLength: 2,
			maxLength: 5,
			description: "Provincia (sigla)",
		}),
	),
	city: Type.String({
		minLength: 1,
		maxLength: 100,
		description: "Città",
		error: "La città è obbligatoria",
	}),
	zipCode: Type.String({
		pattern: "^\\d{5}$",
		description: "CAP (5 cifre)",
		error: "Il CAP deve essere di 5 cifre",
	}),
	categoryId: Type.Optional(
		Type.String({ description: "ID categoria negozio" }),
	),
	openingHours: Type.Optional(
		Type.Unknown({ description: "Orari di apertura (JSON)" }),
	),
	useCompanyAddress: Type.Optional(
		Type.Boolean({
			description: "Se true, copia l'indirizzo dall'azienda registrata",
		}),
	),
});

// ── Step 5: Payment ─────────────────────────

export const PaymentBody = Type.Object({
	stripeAccountId: Type.Optional(
		Type.String({
			pattern: "^acct_[a-zA-Z0-9]+$",
			description: "ID dell'account Stripe Connect",
		}),
	),
});
