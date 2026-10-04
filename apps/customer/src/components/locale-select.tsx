import { LocaleToggle } from "@bibs/ui/custom/locale-toggle";
import { m } from "@/paraglide/messages";
import { getLocale, locales, setLocale } from "@/paraglide/runtime";

/** Selettore lingua: scrive il cookie Paraglide e ricarica la pagina. */
export function LocaleSelect({ className }: { className?: string }) {
	return (
		<LocaleToggle
			locales={locales}
			value={getLocale()}
			onChange={(locale) => setLocale(locale)}
			label={m.language_label()}
			className={className}
		/>
	);
}
