import { Button } from "@bibs/ui/components/button";
import { LocateFixed, MapPin } from "lucide-react";
import { m } from "@/paraglide/messages";
import { FilterSection, RadiusPill } from "./primitives";

/** Raggi offerti dal rail, in km. `undefined` = nessun limite. */
export const RADIUS_PRESETS = [1, 3, 5, 10] as const;

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
 * Sezione distanza: da dove si misura (o l'invito a sceglierlo) e i preset di
 * raggio, che senza origine restano visibili ma spenti.
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
		<FilterSection title={title}>
			{hasOrigin ? (
				<p className="flex items-center gap-1.5 text-saffron-deep text-xs dark:text-saffron">
					<LocateFixed className="size-3.5 shrink-0" aria-hidden />
					{m.origin_distances_from({ label: originLabel })}
				</p>
			) : (
				<div className="space-y-2.5">
					<p className="text-muted-foreground text-xs leading-relaxed">
						{needsOriginText}
					</p>
					<Button
						variant="secondary"
						size="sm"
						className="min-h-11 sm:min-h-9"
						onClick={onChooseOrigin}
					>
						<MapPin className="size-4" aria-hidden />
						{m.origin_choose()}
					</Button>
				</div>
			)}

			<div className="grid grid-cols-3 gap-2 pt-1 lg:flex lg:flex-wrap lg:gap-1.5">
				<RadiusPill
					label={anyLabel}
					active={hasOrigin && radius === undefined}
					disabled={!hasOrigin}
					onClick={() => onRadiusChange(undefined)}
				/>
				{RADIUS_PRESETS.map((km) => (
					<RadiusPill
						key={km}
						label={kmLabel(km)}
						active={hasOrigin && radius === km}
						disabled={!hasOrigin}
						onClick={() => onRadiusChange(km)}
					/>
				))}
			</div>
		</FilterSection>
	);
}
