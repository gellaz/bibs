import { Link } from "@tanstack/react-router";
import { m } from "@/paraglide/messages";

interface SearchTabsProps {
	q?: string;
	near?: string;
	radius?: number;
	openNow?: boolean;
}

const TAB =
	"inline-flex min-h-11 items-center justify-center rounded-md px-4 font-medium text-muted-foreground text-sm transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron data-[status=active]:bg-primary data-[status=active]:text-primary-foreground sm:min-h-9";

/**
 * Passaggio fra le due ricerche. Sono link, non pulsanti: `/products` e
 * `/stores` sono due pagine, e devono restare apribili in una scheda nuova e
 * raggiungibili con indietro.
 *
 * Porta con sé solo ciò che le due ricerche hanno in comune — testo, origine,
 * raggio e "aperti ora". Le categorie no: 14 macro prodotto e 16 macro
 * negozio sono alberi diversi, e un id trasferito non significherebbe niente
 * dall'altra parte.
 */
export function SearchTabs({ q, near, radius, openNow }: SearchTabsProps) {
	const shared = { q, near, radius, openNow };
	return (
		<nav
			aria-label={m.search_tabs_label()}
			className="inline-flex rounded-lg border border-border bg-background p-1"
		>
			<Link to="/products" search={shared} className={TAB}>
				{m.search_tab_products()}
			</Link>
			<Link to="/stores" search={shared} className={TAB}>
				{m.search_tab_stores()}
			</Link>
		</nav>
	);
}
