import { BrandMark } from "@bibs/ui/components/brand-mark";
import { Link } from "@tanstack/react-router";
import { ReceiptText } from "lucide-react";
import { CartBadge } from "@/features/cart/cart-badge";
import { SearchOriginChip } from "@/features/location/search-origin-chip";
import { m } from "@/paraglide/messages";
import { PAGE_CONTAINER } from "./page";
import { UserMenu } from "./user-menu";

/**
 * Top app bar del customer: identità bibs (open hand + wordmark) a sinistra,
 * che funge da link verso la home, il chip dell'origine della ricerca, e il
 * menu account a destra.
 *
 * Chrome calmo del register brand: cream pieno con un bordo 1px warm-edge in
 * basso (separazione disegnata, non ombra — "Flat-By-Default"). La navigazione
 * primaria mobile resta la bottom tab bar prevista da DESIGN.md; questa barra
 * porta identità e accesso all'account.
 */
export function SiteHeader() {
	return (
		<header className="sticky top-0 z-40 border-border border-b bg-background">
			<div
				className={`${PAGE_CONTAINER} flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 sm:h-16 sm:flex-nowrap sm:gap-4 sm:py-0`}
			>
				<Link
					to="/"
					aria-label={m.nav_home_aria()}
					className="-mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-saffron focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					<BrandMark className="size-9" />
					<span className="font-bold font-display text-primary text-xl tracking-[-0.015em]">
						bibs
					</span>
				</Link>
				{/* Sotto `sm` il chip scende su una riga sua: nella prima non ci sta
				    un'etichetta leggibile accanto a identità, navigazione e borsa, e
				    un tap target da 44px la riempirebbe. Da `sm` torna accanto
				    all'identità. Una sola istanza, spostata dal wrapping del flex:
				    due copie aprirebbero due pannelli, perché il contenuto finisce
				    in un portal e il CSS del wrapper non lo nasconde. */}
				<div className="max-sm:order-last max-sm:basis-full">
					<SearchOriginChip />
				</div>
				<nav className="ml-auto mr-2 flex items-center gap-1">
					<Link
						to="/products"
						search={{ q: undefined, categoryId: undefined }}
						className="rounded-md px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[status=active]:text-foreground"
					>
						{m.nav_products()}
					</Link>
					<Link
						to="/stores"
						search={{ q: undefined, categoryId: undefined }}
						className="rounded-md px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[status=active]:text-foreground"
					>
						{m.nav_stores()}
					</Link>
					{/* Sotto `sm` solo l'icona, da 44px come la borsa: il testo non ci
					    sta accanto a identità e navigazione. */}
					<Link
						to="/orders"
						search={{ tab: "reserved", page: 1 }}
						aria-label={m.nav_orders()}
						className="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[status=active]:text-foreground max-sm:size-11 max-sm:justify-center max-sm:px-0"
					>
						<ReceiptText className="size-5 sm:size-4" aria-hidden />
						<span className="max-sm:sr-only">{m.nav_orders()}</span>
					</Link>
					<CartBadge />
				</nav>
				<UserMenu />
			</div>
		</header>
	);
}
