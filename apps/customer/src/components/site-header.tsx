import { BrandMark } from "@bibs/ui/custom/brand-mark";
import { Link } from "@tanstack/react-router";
import { CartBadge } from "@/features/cart/cart-badge";
import { SearchOriginChip } from "@/features/location/search-origin-chip";
import { m } from "@/paraglide/messages";
import { PAGE_CONTAINER } from "./page";
import { UserMenu } from "./user-menu";

/**
 * Voce attiva: Ink pieno + sottolineatura Saffron di 2px (DESIGN.md §Navigation).
 * La sottolineatura cresce dal centro quando la sezione si attiva (ease-out
 * esponenziale, niente con reduced motion); al passaggio del mouse le voci
 * testuali inattive ne mostrano un accenno (non la borsa: sarebbe un trattino). Saffron Deep sul cream per stare sopra 3:1,
 * Saffron pieno su fondi scuri. Il peso non cambia, così le voci non si spostano.
 * Le voci poggiano sul bordo della loro barra: da `sm` sul bordo inferiore
 * dell'header, sotto `sm` sul bordo superiore della tab bar Ink in basso.
 */
const NAV_ITEM_ACTIVE =
	"after:absolute after:h-0.5 after:scale-x-0 after:rounded-full after:bg-saffron-deep after:transition-[scale,opacity] after:duration-300 after:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:after:transition-none dark:after:bg-saffron sm:self-stretch sm:after:-bottom-px data-[status=active]:text-primary data-[status=active]:after:scale-x-100";

const NAV_LINK = `${NAV_ITEM_ACTIVE} relative flex items-center rounded-md px-3 font-medium text-muted-foreground text-sm outline-none transition-colors after:inset-x-3 after:-bottom-px hover:text-primary not-data-[status=active]:hover:after:scale-x-50 not-data-[status=active]:hover:after:opacity-40 focus-visible:focus-ring max-sm:h-14 max-sm:flex-1 max-sm:justify-center max-sm:rounded-none max-sm:text-cream/70 max-sm:after:top-0 max-sm:after:bottom-auto max-sm:after:inset-x-6 max-sm:after:bg-saffron max-sm:hover:text-cream max-sm:data-[status=active]:text-cream`;

/** Le tab di /products, /stores e /orders vivono nella search: la voce resta attiva su ognuna. */
const IGNORE_SEARCH = { includeSearch: false };

/**
 * Top app bar del customer: a sinistra l'identità bibs (open hand + wordmark,
 * link alla home) seguita dalle sezioni; a destra il chip dell'origine della
 * ricerca, la borsa e il menu account.
 *
 * Chrome calmo del register brand: cream pieno con un bordo 1px warm-edge in
 * basso (separazione disegnata, non ombra — "Flat-By-Default"). Sotto `sm` le
 * sezioni scendono nella tab bar in basso e qui restano identità, posizione,
 * borsa e account.
 */
export function SiteHeader() {
	return (
		<header className="sticky top-0 z-40 border-border border-b bg-background">
			<div
				className={`${PAGE_CONTAINER} flex items-center gap-3 py-2 sm:h-16 sm:gap-4 sm:py-0`}
			>
				<Link
					to="/"
					aria-label={m.nav_home_aria()}
					className="-mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 outline-none focus-visible:focus-ring"
				>
					<BrandMark className="size-9" />
					<span className="font-bold font-display text-primary text-xl tracking-[-0.015em]">
						bibs
					</span>
				</Link>
				{/* Sotto `sm` le sezioni diventano una tab bar fissa in basso, a portata
				    di pollice e sempre visibile allo scorrimento. Una sola istanza:
				    cambia posto con il CSS, non viene duplicata. */}
				<nav className="flex items-center gap-1 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:gap-0 max-sm:bg-ink sm:ml-2 sm:self-stretch">
					<Link
						to="/products"
						search={{ q: undefined, categoryId: undefined }}
						activeOptions={IGNORE_SEARCH}
						className={NAV_LINK}
					>
						{m.nav_products()}
					</Link>
					<Link
						to="/stores"
						search={{ q: undefined, categoryId: undefined }}
						activeOptions={IGNORE_SEARCH}
						className={NAV_LINK}
					>
						{m.nav_stores()}
					</Link>
					<Link
						to="/orders"
						search={{ tab: "reserved", page: 1 }}
						activeOptions={IGNORE_SEARCH}
						className={NAV_LINK}
					>
						{m.nav_orders()}
					</Link>
				</nav>
				<div className="ml-auto">
					<SearchOriginChip />
				</div>
				<CartBadge
					className={`${NAV_ITEM_ACTIVE} after:inset-x-2 after:bottom-0`}
				/>
				<UserMenu />
			</div>
		</header>
	);
}
