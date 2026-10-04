/**
 * Locale Intl per i formatter condivisi. `packages/ui` non può importare il
 * runtime Paraglide delle app, quindi ogni app registra un resolver (in
 * `router.tsx`) che legge `getLocale()` a ogni chiamata: in SSR quella della
 * richiesta corrente, anche con richieste concorrenti in lingue diverse.
 */
const INTL_LOCALES: Record<string, string> = { it: "it-IT", en: "en-GB" };
const DEFAULT_INTL_LOCALE = "it-IT";

let resolver: () => string = () => DEFAULT_INTL_LOCALE;

/** Locale Paraglide → tag Intl ("en" → "en-GB"); ignote → "it-IT". */
export function intlLocaleFor(locale: string): string {
	return INTL_LOCALES[locale] ?? DEFAULT_INTL_LOCALE;
}

export function setIntlLocaleResolver(resolve: () => string): void {
	resolver = resolve;
}

/** Il tag Intl della lingua corrente. */
export function intlLocale(): string {
	return resolver();
}
