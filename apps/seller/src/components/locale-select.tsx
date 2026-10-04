import { LocaleToggle } from "@bibs/ui/custom/locale-toggle";
import { m } from "@/paraglide/messages";
import { getLocale, locales, setLocale } from "@/paraglide/runtime";

/**
 * Selettore lingua, per ora solo in dev: l'inglese di questa app non è ancora
 * tradotto (vedi P4 nell'audit). Serve a provare le PR di traduzione; nelle
 * build di produzione non c'è.
 */
export function LocaleSelect() {
	if (!import.meta.env.DEV) return null;
	return (
		<LocaleToggle
			locales={locales}
			value={getLocale()}
			onChange={(locale) => setLocale(locale)}
			label={m.language_label()}
		/>
	);
}
