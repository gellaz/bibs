import { Type } from "@sinclair/typebox";

// ── Livello 1: Modifica libera ──────────────

export const PersonalSettingsBody = Type.Object({
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

export const CompanySettingsBody = Type.Object({
	businessName: Type.String({
		minLength: 1,
		maxLength: 200,
		description: "Ragione sociale",
		error: "La ragione sociale è obbligatoria",
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

// ── Livello 2: Richiesta approvazione admin ─

export const VatChangeBody = Type.Object({
	vatNumber: Type.String({
		pattern: "^[0-9]{11}$",
		description: "Nuova partita IVA italiana (11 cifre)",
		error: "La partita IVA deve essere di 11 cifre",
	}),
});

export const DocumentChangeBody = Type.Object({
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

export const PaymentChangeBody = Type.Object({
	stripeAccountId: Type.String({
		pattern: "^acct_[a-zA-Z0-9]+$",
		description: "Nuovo ID dell'account Stripe Connect",
		error: "ID account Stripe non valido",
	}),
});
