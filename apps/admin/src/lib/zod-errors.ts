import { intlLocaleFor } from "@bibs/ui/lib/intl-locale";
import { type ZodIssueRule, zodIssueRule } from "@bibs/ui/lib/zod-issue-rule";
import { type core, z } from "zod";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";

// Messaggi predefiniti dei form zod: zod 4 usa l'error map globale solo dove
// lo schema non scrive un messaggio (quelli scritti vincono sempre), e la
// chiama alla lettura delle issue, quindi Paraglide dà la lingua corrente anche
// dopo un cambio senza reload. Sotto il campo c'è già l'etichetta: il
// messaggio dice solo la regola (stesse voci `validation_*` del customer).

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
function ruleMessage(rule: ZodIssueRule): string {
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
		case "invalid":
			return m.validation_invalid();
	}
}

export function zodErrorMessage(issue: core.$ZodRawIssue): string {
	return ruleMessage(zodIssueRule(issue));
}

/** Registra l'error map per tutti gli schemi zod dell'app. */
export function registerZodErrors(): void {
	z.config({ localeError: zodErrorMessage });
}
