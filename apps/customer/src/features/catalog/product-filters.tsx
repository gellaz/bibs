import { Skeleton } from "@bibs/ui/components/skeleton";
import { Clock, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { CategoryTree } from "@/features/search/filter-rail/category-tree";
import { DistanceSection } from "@/features/search/filter-rail/distance-section";
import { FacetsError } from "@/features/search/filter-rail/facets-error";
import {
	FilterSection,
	FOCUS_RING,
	ToggleRow,
} from "@/features/search/filter-rail/primitives";
import { m } from "@/paraglide/messages";
import type { ProductMacroFacetView } from "./use-product-facets";

export interface ProductFilterValue {
	macroCategoryId?: string;
	categoryId?: string;
	radius?: number;
	openNow?: boolean;
	onSale?: boolean;
	minPrice?: number;
	maxPrice?: number;
}

interface ProductFiltersProps {
	macros: ProductMacroFacetView[];
	total: number;
	openNowTotal: number;
	onSaleTotal: number;
	isPending: boolean;
	/** I conteggi non sono arrivati: niente zeri inventati, un errore col riprova. */
	isError: boolean;
	onRetry: () => void;
	value: ProductFilterValue;
	hasOrigin: boolean;
	originLabel: string;
	onChooseOrigin: () => void;
	onChange: (next: ProductFilterValue) => void;
}

/**
 * Le due caselle del prezzo si applicano all'uscita dal campo (o con Invio),
 * non a ogni tasto: una cifra alla volta produrrebbe una ricerca per ogni
 * pressione, e "1", "12", "120" sono tre domande diverse di cui solo l'ultima
 * è quella vera.
 */
function PriceBox({
	label,
	ariaLabel,
	value,
	onCommit,
}: {
	label: string;
	ariaLabel: string;
	value: number | undefined;
	onCommit: (next: number | undefined) => void;
}) {
	const [draft, setDraft] = useState(value === undefined ? "" : String(value));

	// Riallinea quando il valore cambia da fuori (azzera filtri, link aperto).
	useEffect(() => {
		setDraft(value === undefined ? "" : String(value));
	}, [value]);

	const commit = () => {
		const trimmed = draft.trim();
		if (trimmed === "") return onCommit(undefined);
		// La virgola è il separatore decimale italiano: senza normalizzarla
		// "12,50" darebbe NaN e l'input verrebbe scartato in silenzio.
		const parsed = Number(trimmed.replace(",", "."));
		// Un valore non numerico o negativo non è un filtro: si torna com'era.
		if (!Number.isFinite(parsed) || parsed < 0) {
			setDraft(value === undefined ? "" : String(value));
			return;
		}
		onCommit(parsed);
	};

	return (
		<label className="flex min-w-0 flex-1 items-center gap-1.5">
			<span className="shrink-0 text-muted-foreground text-xs">{label}</span>
			<input
				type="number"
				inputMode="decimal"
				min={0}
				step={1}
				value={draft}
				aria-label={ariaLabel}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					}
				}}
				className={`h-11 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground tabular-nums lg:h-9 ${FOCUS_RING} focus-visible:border-primary`}
			/>
		</label>
	);
}

/**
 * Rail dei filtri prodotti: disponibilità, categoria, prezzo e distanza. Lo
 * stesso nodo serve il rail da `lg` e il pannello mobile, quindi non porta
 * larghezza né posizionamento propri.
 */
export function ProductFilters({
	macros,
	total,
	openNowTotal,
	onSaleTotal,
	isPending,
	isError,
	onRetry,
	value,
	hasOrigin,
	originLabel,
	onChooseOrigin,
	onChange,
}: ProductFiltersProps) {
	const { radius, openNow, onSale, minPrice, maxPrice } = value;

	return (
		<div className="space-y-7">
			{isError ? (
				<FacetsError onRetry={onRetry} />
			) : (
				<>
					<FilterSection title={m.product_filter_availability()}>
						{isPending ? (
							<div className="-mx-2 space-y-1.5" aria-hidden>
								<Skeleton className="h-11 lg:h-9" />
								<Skeleton className="h-11 lg:h-9" />
							</div>
						) : (
							<div className="-mx-2">
								<ToggleRow
									icon={Clock}
									label={m.product_open_now()}
									count={openNowTotal}
									active={openNow === true}
									// A zero il filtro garantisce la lista vuota; resta cliccabile
									// solo se è già acceso, altrimenti non si potrebbe spegnere.
									disabled={openNowTotal === 0 && openNow !== true}
									onClick={() => onChange({ ...value, openNow: !openNow })}
								/>
								{/* Con zero risultati in tutto la causa non è l'orario. */}
								{openNowTotal === 0 && total > 0 && (
									<p className="px-2 pt-1 text-muted-foreground text-xs leading-relaxed">
										{m.product_open_now_none()}
									</p>
								)}
								<ToggleRow
									icon={Tag}
									label={m.product_on_sale()}
									count={onSaleTotal}
									active={onSale === true}
									disabled={onSaleTotal === 0 && onSale !== true}
									onClick={() => onChange({ ...value, onSale: !onSale })}
								/>
								{onSaleTotal === 0 && total > 0 && (
									<p className="px-2 pt-1 text-muted-foreground text-xs leading-relaxed">
										{m.product_on_sale_none()}
									</p>
								)}
							</div>
						)}
					</FilterSection>

					<FilterSection title={m.product_filter_category()}>
						<CategoryTree
							macros={macros}
							count={(node) => node.productCount}
							allLabel={m.product_category_all()}
							total={total}
							isPending={isPending}
							value={value}
							onSelect={(next) => onChange({ ...value, ...next })}
						/>
					</FilterSection>
				</>
			)}

			<FilterSection title={m.product_filter_price()}>
				<div className="flex items-center gap-2">
					<PriceBox
						label={m.product_price_min()}
						ariaLabel={m.product_price_min_aria()}
						value={minPrice}
						onCommit={(next) => onChange({ ...value, minPrice: next })}
					/>
					<PriceBox
						label={m.product_price_max()}
						ariaLabel={m.product_price_max_aria()}
						value={maxPrice}
						onCommit={(next) => onChange({ ...value, maxPrice: next })}
					/>
				</div>
				<p className="text-muted-foreground text-xs leading-relaxed">
					{m.product_price_hint()}
				</p>
			</FilterSection>

			<DistanceSection
				title={m.product_filter_distance()}
				needsOriginText={m.product_distance_needs_origin()}
				anyLabel={m.product_radius_any()}
				kmLabel={(km) => m.product_radius_km({ km })}
				hasOrigin={hasOrigin}
				originLabel={originLabel}
				onChooseOrigin={onChooseOrigin}
				radius={radius}
				onRadiusChange={(next) => onChange({ ...value, radius: next })}
			/>
		</div>
	);
}
