import { LocaleSelect } from "@/components/locale-select";

/** Lingua sulle pagine senza login, dove il menu utente non c'è. */
export function AuthLocaleFooter() {
	return <LocaleSelect className="w-full max-w-sm px-0" />;
}
