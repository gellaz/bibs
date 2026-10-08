import { Button } from "@bibs/ui/components/button";
import { ToggleGroup, ToggleGroupItem } from "@bibs/ui/components/toggle-group";
import { LocateFixed, MapPin } from "lucide-react";
import { m } from "@/paraglide/messages";

/** Raggi offerti, in km. `undefined` = nessun limite. */
export const RADIUS_PRESETS = [1, 3, 5, 10] as const;

/** Il valore del gruppo è una stringa: "any" sta per nessun limite. */
const ANY = "any";

/** Stessa voce attiva del selettore Lista/Mappa: la scelta corrente prende l'Ink pieno. */
const ITEM =
	"min-h-11 text-[0.8125rem] tabular-nums group-data-[spacing=0]/toggle-group:px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground sm:min-h-8";

interface DistanceSectionProps {
	title: string;
	/** Il perché dei preset spenti quando manca un'origine. */
	needsOriginText: string;
	anyLabel: string;
	kmLabel: (km: number) => string;
	/** C'è una posizione da cui misurare: GPS o un indirizzo salvato. */
	hasOrigin: boolean;
	originLabel: string;
	onChooseOrigin: () => void;
	radius: number | undefined;
	onRadiusChange: (next: number | undefined) => void;
}

/**
 * Barra della distanza sopra la ricerca: un selettore segmentato per il raggio
 * e, accanto, da dove si misura (o l'invito a sceglierlo). Sta fuori dal rail
 * perché "quanto vicino" è la domanda di bibs, non un filtro fra gli altri;
 * senza origine il selettore resta visibile ma spento.
 */
export function DistanceSection({
	title,
	needsOriginText,
	anyLabel,
	kmLabel,
	hasOrigin,
	originLabel,
	onChooseOrigin,
	radius,
	onRadiusChange,
}: DistanceSectionProps) {
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
			<ToggleGroup
				type="single"
				size="sm"
				variant="outline"
				disabled={!hasOrigin}
				// Senza origine nessuna voce è accesa: il raggio non si applica.
				value={hasOrigin ? String(radius ?? ANY) : ""}
				// Radix emette "" quando si ri-clicca la voce attiva: un raggio c'è sempre.
				onValueChange={(next) =>
					next && onRadiusChange(next === ANY ? undefined : Number(next))
				}
				aria-label={title}
				className="max-sm:w-full"
			>
				<ToggleGroupItem value={ANY} className={`${ITEM} max-sm:flex-1`}>
					{anyLabel}
				</ToggleGroupItem>
				{RADIUS_PRESETS.map((km) => (
					<ToggleGroupItem
						key={km}
						value={String(km)}
						className={`${ITEM} max-sm:flex-1`}
					>
						{kmLabel(km)}
					</ToggleGroupItem>
				))}
			</ToggleGroup>

			{hasOrigin ? (
				<p className="flex items-center gap-1.5 text-saffron-deep text-xs dark:text-saffron">
					<LocateFixed className="size-3.5 shrink-0" aria-hidden />
					{m.origin_distances_from({ label: originLabel })}
				</p>
			) : (
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
					{needsOriginText}
					<Button
						variant="link"
						size="sm"
						className="h-auto min-h-11 gap-1 px-0 text-xs sm:min-h-0"
						onClick={onChooseOrigin}
					>
						<MapPin className="size-3.5" aria-hidden />
						{m.origin_choose()}
					</Button>
				</p>
			)}
		</div>
	);
}
