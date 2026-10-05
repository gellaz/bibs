import type { ValidationRule } from "@bibs/api/validation-rule";
import { intlLocaleFor } from "@bibs/ui/lib/intl-locale";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";

// La regola di validazione nella lingua corrente, per i form TypeBox
// (`typebox-errors.ts`) e zod (`zod-errors.ts`). Niente TypeBox a runtime qui:
// i form zod non devono trascinarlo nei loro chunk.

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
