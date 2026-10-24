import { ToggleGroup, ToggleGroupItem } from "@bibs/ui/components/toggle-group";
import { LayoutGrid, Map as MapIcon } from "lucide-react";
import { m } from "@/paraglide/messages";

export type StoreView = "list" | "map";

/**
 * Selettore della vista. Le voci del ToggleGroup espongono `aria-pressed`, quindi
 * la vista attiva è annunciata senza aria-* aggiunti a mano. Lo stato premuto di default è
 * un `bg-muted` da hover: qui la scelta è binaria e va letta a colpo d'occhio,
 * quindi la vista attiva prende la superficie piena.
 */
export function StoreViewToggle({
	value,
	onChange,
}: {
	value: StoreView;
	onChange: (value: StoreView) => void;
}) {
	return (
		<ToggleGroup
			size="sm"
			variant="outline"
			value={[value]}
			// Ri-cliccare la voce attiva la spegne ([]): una vista deve sempre
			// esserci, quindi si ignora.
			onValueChange={([next]) => next && onChange(next as StoreView)}
			aria-label={m.store_view_label()}
		>
			<ToggleGroupItem
				value="list"
				className="data-pressed:bg-primary data-pressed:text-primary-foreground"
			>
				<LayoutGrid className="size-4" aria-hidden />
				{m.store_view_list()}
			</ToggleGroupItem>
			<ToggleGroupItem
				value="map"
				className="data-pressed:bg-primary data-pressed:text-primary-foreground"
			>
				<MapIcon className="size-4" aria-hidden />
				{m.store_view_map()}
			</ToggleGroupItem>
		</ToggleGroup>
	);
}
