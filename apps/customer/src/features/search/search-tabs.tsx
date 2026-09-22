import { Link } from "@tanstack/react-router";
import { m } from "@/paraglide/messages";

interface SearchTabsProps {
	current: "products" | "stores";
	q?: string;
	near?: string;
	radius?: number;
	openNow?: boolean;
}

const TAB =
	"inline-flex min-h-11 items-center justify-center rounded-md px-4 font-medium text-muted-foreground text-sm transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron data-[status=active]:bg-primary data-[status=active]:text-primary-foreground sm:min-h-9";

/** Stessa apparenza di `data-[status=active]`, applicata a mano sulla scheda corrente. */
const TAB_CURRENT = "bg-primary text-primary-foreground";

/**
 * Passaggio fra le due ricerche. Sono link, non pulsanti: `/products` e
 * `/stores` sono due pagine, e devono restare apribili in una scheda nuova e
 * raggiungibili con indietro.
 *
 * Porta con sé solo ciò che le due ricerche hanno in comune — testo, origine,
 * raggio e "aperti ora". Le categorie no: 14 macro prodotto e 16 macro
 * negozio sono alberi diversi, e un id trasferito non significherebbe niente
 * dall'altra parte.
 *
 * La scheda già attiva (`current`) non è un `Link`: `search` sostituisce
 * l'intera query string, e navigare verso la pagina in cui si è già
 * butterebbe via `view`/`categoryId` e gli altri parametri specifici di
 * quella ricerca. È uno `<span>` con lo stesso aspetto, non una navigazione.
 */
export function SearchTabs({
	current,
	q,
	near,
	radius,
	openNow,
}: SearchTabsProps) {
	const shared = { q, near, radius, openNow };
	return (
		<nav
			aria-label={m.search_tabs_label()}
			className="inline-flex rounded-lg border border-border bg-background p-1"
		>
			{current === "products" ? (
				<span aria-current="page" className={`${TAB} ${TAB_CURRENT}`}>
					{m.search_tab_products()}
				</span>
			) : (
				<Link to="/products" search={shared} className={TAB}>
					{m.search_tab_products()}
				</Link>
			)}
			{current === "stores" ? (
				<span aria-current="page" className={`${TAB} ${TAB_CURRENT}`}>
					{m.search_tab_stores()}
				</span>
			) : (
				<Link to="/stores" search={shared} className={TAB}>
					{m.search_tab_stores()}
				</Link>
			)}
		</nav>
	);
}
