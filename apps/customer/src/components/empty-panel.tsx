import { buttonVariants } from "@bibs/ui/components/button";
import { EmptyState, type EmptyStateProps } from "@bibs/ui/custom/empty-state";
import { cn } from "@bibs/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { m } from "@/paraglide/messages";

/**
 * Stato vuoto del customer: lo stesso EmptyState del seller, nel riquadro che
 * lì gli dà la DataTable, largo quanto la colonna che lo ospita. Errori e
 * pagine non trovate restano su `Notice`.
 */
export function EmptyPanel(props: EmptyStateProps) {
	return (
		<div className="rounded-lg border bg-card px-6 shadow-sm">
			<EmptyState {...props} />
		</div>
	);
}

/** Le due porte della top bar, per i vuoti che si riempiono comprando. */
export function exploreActions() {
	return {
		action: (
			<Link
				to="/products"
				search={{ q: undefined, categoryId: undefined }}
				className={cn(buttonVariants(), "min-h-11 sm:min-h-9")}
			>
				{m.explore_products_cta()}
			</Link>
		),
		secondary: (
			<Link
				to="/stores"
				search={{ q: undefined, categoryId: undefined }}
				className={cn(
					buttonVariants({ variant: "outline" }),
					"min-h-11 sm:min-h-9",
				)}
			>
				{m.explore_stores_cta()}
			</Link>
		),
	};
}
