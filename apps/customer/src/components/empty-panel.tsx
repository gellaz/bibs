import { Button } from "@bibs/ui/components/button";
import { EmptyState, type EmptyStateProps } from "@bibs/ui/custom/empty-state";
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
			<Button
				className="min-h-11 sm:min-h-9"
				nativeButton={false}
				render={
					<Link
						to="/products"
						search={{ q: undefined, categoryId: undefined }}
					/>
				}
			>
				{m.explore_products_cta()}
			</Button>
		),
		secondary: (
			<Button
				variant="outline"
				className="min-h-11 sm:min-h-9"
				nativeButton={false}
				render={
					<Link to="/stores" search={{ q: undefined, categoryId: undefined }} />
				}
			>
				{m.explore_stores_cta()}
			</Button>
		),
	};
}
