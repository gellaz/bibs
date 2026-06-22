import { BrandMark } from "@bibs/ui/components/brand-mark";
import { Link } from "@tanstack/react-router";
import { UserMenu } from "./user-menu";

/**
 * Top app bar del customer: identità bibs (open hand + wordmark) a sinistra,
 * che funge da link verso la home, e il menu account a destra.
 *
 * Chrome calmo del register brand: cream pieno con un bordo 1px warm-edge in
 * basso (separazione disegnata, non ombra — "Flat-By-Default"). La navigazione
 * primaria mobile resta la bottom tab bar prevista da DESIGN.md; questa barra
 * porta identità e accesso all'account.
 */
export function SiteHeader() {
	return (
		<header className="sticky top-0 z-40 border-border border-b bg-background">
			<div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:h-16 sm:px-6">
				<Link
					to="/"
					aria-label="bibs, torna alla home"
					className="-mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-saffron focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					<BrandMark className="size-9" />
					<span className="font-bold font-display text-primary text-xl tracking-[-0.015em]">
						bibs
					</span>
				</Link>
				<UserMenu />
			</div>
		</header>
	);
}
