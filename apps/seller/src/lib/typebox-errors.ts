import { type ValidationRule, validationRule } from "@bibs/api/validation-rule";
import { intlLocaleFor } from "@bibs/ui/lib/intl-locale";
import {
	type ErrorFunctionParameter,
	SetErrorFunction,
	ValueErrorType,
} from "@sinclair/typebox/errors";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";

// Messaggi di TypeBox per i form con `typeboxResolver`: il resolver mostra
// `error.message`, che TypeBox costruisce a ogni validazione con la funzione
// d'errore definita qui (registrata da `typebox-resolver.ts`), quindi nella
// lingua corrente, anche dopo un cambio senza reload. Sotto il campo c'è già
// l'etichetta: il messaggio dice solo la regola.

/**
 * Gli `error:` scritti sugli schemi condivisi con l'API sono in italiano (sono
 * anche i messaggi dei 422). Qui la loro traduzione; un test controlla che
 * ogni `error:` degli schemi dei form abbia la sua voce.
 */
const SCHEMA_ERRORS: Record<string, () => string> = {
	"Il nome è obbligatorio": m.validation_schema_name_required,
	"Inserisci un prezzo valido (max 2 decimali)": m.validation_schema_price,
	"EAN deve essere 8 o 13 cifre": m.validation_schema_ean,
	"Il numero è obbligatorio (minimo 5 caratteri)":
		m.validation_schema_phone_number,
	"La posizione del negozio sulla mappa è obbligatoria":
		m.validation_schema_store_location,
	"L'indirizzo è obbligatorio": m.validation_schema_address_required,
	"Il comune è obbligatorio": m.validation_schema_municipality_required,
	"Il CAP deve essere di 5 cifre": m.validation_schema_zip,
	"Formato orario non valido (HH:mm)": m.validation_schema_time,
	"Il cognome è obbligatorio": m.validation_schema_last_name_required,
	"Seleziona la cittadinanza": m.validation_schema_citizenship,
	"Seleziona il paese di nascita": m.validation_schema_birth_country,
	"Data non valida (AAAA-MM-GG)": m.validation_schema_date,
	"Seleziona il paese di residenza": m.validation_schema_residence_country,
	"Il comune di residenza è obbligatorio":
		m.validation_schema_residence_municipality,
	"L'indirizzo di residenza è obbligatorio":
		m.validation_schema_residence_address,
	"Il numero del documento deve avere tra 5 e 20 caratteri":
		m.validation_schema_document_number,
	"Il comune di emissione è obbligatorio":
		m.validation_schema_document_municipality,
	"La ragione sociale è obbligatoria": m.validation_schema_business_name,
	"La partita IVA deve essere di 11 cifre": m.validation_schema_vat_number,
	"La forma giuridica è obbligatoria": m.validation_schema_legal_form,
};

const FORMAT_RULES: Record<string, () => string> = {
	email: m.validation_format_email,
	uuid: m.validation_format_uuid,
	"calendar-date": m.validation_format_calendar_date,
	uri: m.validation_format_uri,
	"date-time": m.validation_format_date_time,
};

function num(n: number): string {
	return new Intl.NumberFormat(intlLocaleFor(getLocale())).format(n);
}

/** La regola nella lingua corrente, con l'iniziale maiuscola. */
export function ruleMessage(rule: ValidationRule): string {
	switch (rule.kind) {
		case "required":
			return m.validation_required();
		case "string":
			return m.validation_string();
		case "number":
			return m.validation_number();
		case "integer":
			return m.validation_integer();
		case "boolean":
			return m.validation_boolean();
		case "array":
			return m.validation_array();
		case "date":
			return m.validation_date();
		case "notAllowed":
			return m.validation_not_allowed();
		case "fileType":
			return m.validation_file_type();
		case "minLength":
			return m.validation_min_length({ limit: num(rule.limit) });
		case "maxLength":
			return rule.limit === 1
				? m.validation_max_length_one()
				: m.validation_max_length({ limit: num(rule.limit) });
		case "pattern":
			return m.validation_pattern();
		case "format":
			return (FORMAT_RULES[rule.format] ?? m.validation_pattern)();
		case "minimum":
			return m.validation_minimum({ limit: num(rule.limit) });
		case "maximum":
			return m.validation_maximum({ limit: num(rule.limit) });
		case "exclusiveMinimum":
			return m.validation_exclusive_minimum({ limit: num(rule.limit) });
		case "exclusiveMaximum":
			return m.validation_exclusive_maximum({ limit: num(rule.limit) });
		case "minItems":
			return rule.limit === 1
				? m.validation_min_items_one()
				: m.validation_min_items({ count: num(rule.limit) });
		case "maxItems":
			return rule.limit === 1
				? m.validation_max_items_one()
				: m.validation_max_items({ count: num(rule.limit) });
		case "uniqueItems":
			return m.validation_unique_items();
		case "invalid":
			return m.validation_invalid();
	}
}

/**
 * Funzione d'errore di TypeBox. L'`error:` dello schema vince, come nei 422
 * dell'API: tradotto se ha una voce, altrimenti così com'è in italiano e con
 * la regola tradotta nelle altre lingue (meglio generico che in italiano).
 * Tranne sulla lunghezza massima: gli `error:` sono scritti per il campo vuoto
 * o il formato («Il nome è obbligatorio»), e su un testo troppo lungo
 * direbbero il falso.
 */
export function typeboxErrorMessage(error: ErrorFunctionParameter): string {
	const custom: unknown = error.schema.error;
	if (
		typeof custom === "string" &&
		error.errorType !== ValueErrorType.StringMaxLength
	) {
		const translated = SCHEMA_ERRORS[custom];
		if (translated) return translated();
		if (getLocale() === "it") return custom;
	}
	return ruleMessage(
		validationRule({
			type: error.errorType,
			schema: error.schema,
			value: error.value,
		}),
	);
}

/** Registra la funzione d'errore per tutti i TypeCompiler/Value.Errors dell'app. */
export function registerTypeboxErrors(): void {
	SetErrorFunction(typeboxErrorMessage);
}
