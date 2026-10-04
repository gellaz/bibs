import { type DayPickerLocale, enGB, it } from "react-day-picker/locale";
import { intlLocale } from "~/lib/intl-locale";

/**
 * Locale di react-day-picker per la lingua corrente: nomi di mesi e giorni,
 * primo giorno della settimana ed etichette accessibili. Senza, `Calendar`
 * cade sull'`enUS` della libreria anche in italiano. Segue lo stesso resolver
 * di `intlLocale()`, quindi va passata a ogni render (`locale={dayPickerLocale()}`).
 */
export function dayPickerLocale(): DayPickerLocale {
	return intlLocale() === "en-GB" ? enGB : it;
}
