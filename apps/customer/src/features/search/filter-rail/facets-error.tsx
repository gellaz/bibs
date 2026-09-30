import { Button } from "@bibs/ui/components/button";
import { m } from "@/paraglide/messages";

/**
 * Al posto di disponibilità e categorie quando i conteggi non arrivano: con i
 * totali a 0 il rail direbbe "nessun negozio aperto" e spegnerebbe i filtri,
 * cioè mentirebbe. Condiviso dal rail negozi e da quello prodotti.
 */
export function FacetsError({ onRetry }: { onRetry: () => void }) {
	return (
		<div role="status" className="space-y-3">
			<p className="text-muted-foreground text-sm leading-relaxed">
				{m.filters_error()}
			</p>
			<Button variant="outline" size="sm" onClick={onRetry}>
				{m.filters_retry()}
			</Button>
		</div>
	);
}
