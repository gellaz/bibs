import { ToggleGroup, ToggleGroupItem } from "@bibs/ui/components/toggle-group";
import { LayoutGrid, Map as MapIcon } from "lucide-react";
import { m } from "@/paraglide/messages";

export type StoreView = "list" | "map";

/**
 * Selettore della vista. `type="single"` espone il ruolo radio, quindi la vista
 * attiva è annunciata senza aria-* aggiunti a mano. Lo stato "on" di default è
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
			type="single"
			size="sm"
			variant="outline"
			value={value}
			// Radix emette "" quando si ri-clicca la voce attiva: una vista deve
			// sempre esserci, quindi si ignora.
			onValueChange={(next) => next && onChange(next as StoreView)}
			aria-label={m.store_view_label()}
		>
			<ToggleGroupItem
				value="list"
				className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
			>
				<LayoutGrid className="size-4" aria-hidden />
				{m.store_view_list()}
			</ToggleGroupItem>
			<ToggleGroupItem
				value="map"
				className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
			>
				<MapIcon className="size-4" aria-hidden />
				{m.store_view_map()}
			</ToggleGroupItem>
		</ToggleGroup>
	);
}
