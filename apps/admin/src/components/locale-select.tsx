import { LocaleToggle } from "@bibs/ui/custom/locale-toggle";
import { m } from "@/paraglide/messages";
import { getLocale, locales, setLocale } from "@/paraglide/runtime";

/** Selettore lingua del menu utente: la scelta resta nel cookie. */
export function LocaleSelect() {
	return (
		<LocaleToggle
			locales={locales}
			value={getLocale()}
			onChange={(locale) => setLocale(locale)}
			label={m.language_label()}
		/>
	);
}
