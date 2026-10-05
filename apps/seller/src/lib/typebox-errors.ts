import { validationRule } from "@bibs/api/validation-rule";
import {
	type ErrorFunctionParameter,
	SetErrorFunction,
	ValueErrorType,
} from "@sinclair/typebox/errors";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";
import { ruleMessage } from "./rule-message";

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
