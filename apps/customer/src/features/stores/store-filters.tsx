import { Skeleton } from "@bibs/ui/components/skeleton";
import { Clock } from "lucide-react";
import { CategoryTree } from "@/features/search/filter-rail/category-tree";
import { DistanceSection } from "@/features/search/filter-rail/distance-section";
import { FacetsError } from "@/features/search/filter-rail/facets-error";
import {
	FilterSection,
	ToggleRow,
} from "@/features/search/filter-rail/primitives";
import { m } from "@/paraglide/messages";
import type { MacroFacet } from "./use-store-facets";

export interface StoreFilterValue {
	macroCategoryId?: string;
	categoryId?: string;
	radius?: number;
	openNow?: boolean;
}

interface StoreFiltersProps {
	macros: MacroFacet[];
	total: number;
	/** Quanti negozi sono aperti adesso, a parità di testo e raggio. */
	openNowTotal: number;
	isPending: boolean;
	/** I conteggi non sono arrivati: niente zeri inventati, un errore col riprova. */
	isError: boolean;
	onRetry: () => void;
	value: StoreFilterValue;
	/** C'è una posizione da cui misurare: GPS o un indirizzo salvato. */
	hasOrigin: boolean;
	originLabel: string;
	onChooseOrigin: () => void;
	onChange: (next: StoreFilterValue) => void;
}

/**
 * Rail dei filtri: disponibilità, categoria (macro → categoria) e distanza. Lo
 * stesso nodo serve il rail da `lg` e il pannello mobile, quindi non porta
 * larghezza né posizionamento propri.
 */
export function StoreFilters({
	macros,
	total,
	openNowTotal,
	isPending,
	isError,
	onRetry,
	value,
	hasOrigin,
	originLabel,
	onChooseOrigin,
	onChange,
}: StoreFiltersProps) {
	const { openNow } = value;

	return (
		<div className="space-y-7">
			{isError ? (
				<FacetsError onRetry={onRetry} />
			) : (
				<>
					<FilterSection title={m.store_filter_availability()}>
						{isPending ? (
							<Skeleton className="h-6 w-2/5" />
						) : (
							<div className="-mx-2">
								<ToggleRow
									icon={Clock}
									label={m.store_open_now()}
									count={openNowTotal}
									active={openNow === true}
									// A zero il filtro garantisce la lista vuota; resta cliccabile
									// solo se è già acceso, altrimenti non si potrebbe spegnere.
									disabled={openNowTotal === 0 && openNow !== true}
									onClick={() => onChange({ ...value, openNow: !openNow })}
								/>
								{openNowTotal === 0 && total > 0 && (
									// Vero esattamente quanto il conteggio: misurato su testo e
									// raggio, non sulla categoria scelta. Se non resta nessun
									// negozio del tutto, l'orario non c'entra e il messaggio
									// indicherebbe la causa sbagliata.
									<p className="px-2 pt-1 text-muted-foreground text-xs leading-relaxed">
										{m.store_open_now_none()}
									</p>
								)}
							</div>
						)}
					</FilterSection>

					<FilterSection title={m.store_filter_category()}>
						<CategoryTree
							macros={macros}
							count={(node) => node.storeCount}
							allLabel={m.store_category_all()}
							total={total}
							isPending={isPending}
							value={value}
							onSelect={(next) => onChange({ ...value, ...next })}
						/>
					</FilterSection>
				</>
			)}

			<DistanceSection
				title={m.store_filter_distance()}
				needsOriginText={m.store_distance_needs_origin()}
				anyLabel={m.store_radius_any()}
				kmLabel={(km) => m.store_radius_km({ km })}
				hasOrigin={hasOrigin}
				originLabel={originLabel}
				onChooseOrigin={onChooseOrigin}
				radius={value.radius}
				onRadiusChange={(radius) => onChange({ ...value, radius })}
			/>
		</div>
	);
}
