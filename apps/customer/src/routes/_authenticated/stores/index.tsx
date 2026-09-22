import { Button } from "@bibs/ui/components/button";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@bibs/ui/components/sheet";
import { createFileRoute } from "@tanstack/react-router";
import {
	Compass,
	Map as MapIcon,
	RotateCw,
	SlidersHorizontal,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Notice } from "@/components/notice";
import { PAGE_CONTAINER } from "@/components/page";
import { TileSkeleton } from "@/components/tile";
import { originLabel } from "@/features/location/origin-label";
import { useSearchOrigin } from "@/features/location/search-origin";
import { useNearParam } from "@/features/location/use-near-param";
import { SearchField } from "@/features/search/search-field";
import { useSearchTextParam } from "@/features/search/use-search-text-param";
import type { StoreFilterValue } from "@/features/stores/store-filters";
import { StoreFilters } from "@/features/stores/store-filters";
import { StoreTile } from "@/features/stores/store-tile";
import type { StoreView } from "@/features/stores/store-view-toggle";
import { StoreViewToggle } from "@/features/stores/store-view-toggle";
import { useStoreFacets } from "@/features/stores/use-store-facets";
import { useStoreMap } from "@/features/stores/use-store-map";
import { useStoreSearch } from "@/features/stores/use-store-search";
import { m } from "@/paraglide/messages";

/**
 * Rail dei filtri a sinistra e risultati a destra da `lg`; sotto, i filtri
 * finiscono in un pannello e la ricerca resta la sola cosa sopra la griglia.
 * `items-start` tiene il rail alla sua altezza invece di stirarlo per tutta la
 * colonna dei risultati.
 */
const LAYOUT_GRID =
	"grid items-start gap-x-8 gap-y-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:gap-x-10 xl:grid-cols-[17rem_minmax(0,1fr)]";

/**
 * La griglia vive dentro una colonna più stretta della pagina: le colonne le
 * decide la larghezza disponibile, non il viewport.
 */
const RESULTS_GRID =
	"grid grid-cols-2 gap-x-4 gap-y-6 @xl:grid-cols-3 @4xl:grid-cols-4";

/**
 * Su desktop la mappa riempie la finestra sotto la riga dei risultati, così non
 * si scrolla la pagina per vederne il fondo; su mobile resta una superficie
 * alta ma finita.
 */
const MAP_FRAME = "h-[26rem] min-h-80 sm:h-[32rem] lg:h-[calc(100dvh-16rem)]";

const LazyStoreSearchMap = lazy(
	() => import("@/features/stores/store-search-map"),
);

/** Tutti i parametri sono opzionali: `/stores` nudo è una vista valida. */
interface StoreSearchParams {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	radius?: number;
	openNow?: boolean;
	/** Assente = lista: `/stores` nudo resta la vista di sempre. */
	view?: "map";
	/**
	 * Da dove si cerca: `gps` o l'id di un indirizzo. Mai coordinate — un link
	 * condiviso non deve dire dove abiti, e a chi lo riceve l'id non risolve
	 * nulla. Assente = si eredita l'origine attiva.
	 */
	near?: string;
}

export const Route = createFileRoute("/_authenticated/stores/")({
	validateSearch: (search: Record<string, unknown>): StoreSearchParams => ({
		q: typeof search.q === "string" ? search.q : undefined,
		categoryId:
			typeof search.categoryId === "string" ? search.categoryId : undefined,
		macroCategoryId:
			typeof search.macroCategoryId === "string"
				? search.macroCategoryId
				: undefined,
		radius: typeof search.radius === "number" ? search.radius : undefined,
		// `false` esce dall'URL: un filtro spento non è uno stato da descrivere.
		openNow: search.openNow === true ? true : undefined,
		view: search.view === "map" ? "map" : undefined,
		near: typeof search.near === "string" ? search.near : undefined,
	}),
	component: StoresPage,
});

function StoresPage() {
	const navigate = Route.useNavigate();
	const { q, categoryId, macroCategoryId, radius, openNow, view, near } =
		Route.useSearch();
	const [filtersOpen, setFiltersOpen] = useState(false);
	const { origin, coords, geoStatus, setPickerOpen } = useSearchOrigin();

	const [text, setText] = useSearchTextParam(q, (next) => {
		void navigate({ search: (prev) => ({ ...prev, q: next }), replace: true });
	});

	useNearParam(near, (next) => {
		void navigate({
			search: (prev) => ({ ...prev, near: next }),
			replace: true,
		});
	});

	const facets = useStoreFacets({ q, coords, radius, openNow });

	const isMap = view === "map";

	const {
		stores,
		total,
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
		isPending,
		isError,
		refetch,
	} = useStoreSearch({
		q,
		categoryId,
		macroCategoryId,
		coords,
		radius,
		openNow,
		// In mappa la lista non è mostrata: niente pagina di risultati da
		// scaricare a ogni cambio filtro, la mappa ha già la sua query.
		enabled: !isMap,
	});

	const map = useStoreMap({
		q,
		categoryId,
		macroCategoryId,
		coords,
		radius,
		openNow,
		enabled: isMap,
	});

	// In vista mappa il numero autorevole è quello della query mappa: la lista è
	// spenta, e i suoi `total`/`isPending` resterebbero fermi a 0/true per sempre.
	const resultsTotal = isMap ? map.total : total;
	const resultsPending = isMap ? map.isPending : isPending;

	// Leaflet è DOM-only: la mappa monta solo dopo l'hydration, mai in SSR.
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);

	// Niente `replace: true` qui (a differenza del testo di ricerca, che è
	// debounced): tornare indietro dalla mappa alla lista è un'aspettativa
	// legittima, e `navigate` senza `replace` lascia la voce nella cronologia.
	const changeView = (next: StoreView) => {
		void navigate({
			search: (prev) => ({ ...prev, view: next === "map" ? "map" : undefined }),
		});
	};

	const filterValue: StoreFilterValue = {
		macroCategoryId,
		categoryId,
		radius,
		openNow,
	};
	// Senza posizione il raggio non viene inviato: contarlo tra i filtri attivi
	// annuncerebbe una restrizione che i risultati non hanno. Da questa PR una
	// posizione può venire anche da un indirizzo salvato, non solo dal GPS.
	const radiusApplies = radius !== undefined && coords !== null;
	const activeFilterCount =
		(categoryId || macroCategoryId ? 1 : 0) +
		(radiusApplies ? 1 : 0) +
		(openNow ? 1 : 0);
	const hasQuery = Boolean(q) || activeFilterCount > 0;

	const applyFilters = (next: StoreFilterValue) => {
		void navigate({
			search: (prev) => ({
				...prev,
				macroCategoryId: next.macroCategoryId,
				categoryId: next.categoryId,
				radius: next.radius,
				openNow: next.openNow || undefined,
			}),
			replace: true,
		});
	};

	const clearFilters = () =>
		applyFilters({
			macroCategoryId: undefined,
			categoryId: undefined,
			radius: undefined,
			openNow: undefined,
		});

	const filters = (
		<StoreFilters
			macros={facets.macros}
			total={facets.total}
			openNowTotal={facets.openNowTotal}
			isPending={facets.isPending}
			value={filterValue}
			hasOrigin={coords !== null}
			originLabel={originLabel(origin, geoStatus)}
			onChooseOrigin={() => setPickerOpen(true)}
			onChange={applyFilters}
		/>
	);

	// Nome del filtro attivo per la riga dei risultati: da lì sotto `lg` è
	// l'unico posto in cui si legge cosa è selezionato, il rail è chiuso.
	const activeMacro = facets.macros.find((mc) => mc.id === macroCategoryId);
	const activeCategoryName =
		activeMacro?.categories.find((c) => c.id === categoryId)?.name ??
		facets.macros
			.flatMap((mc) => mc.categories)
			.find((c) => c.id === categoryId)?.name;
	const scopeLabel = activeCategoryName ?? activeMacro?.name;

	const listResults = isPending ? (
		<div className={RESULTS_GRID} aria-hidden>
			{Array.from({ length: 8 }, (_, i) => (
				<TileSkeleton key={`tile-skeleton-${i}`} />
			))}
		</div>
	) : isError ? (
		<Notice
			icon={RotateCw}
			title={m.store_load_error_title()}
			description={m.store_load_error_description()}
			action={
				<Button variant="secondary" size="sm" onClick={() => refetch()}>
					<RotateCw className="size-4" aria-hidden />
					{m.store_retry()}
				</Button>
			}
		/>
	) : stores.length === 0 ? (
		<Notice
			icon={Compass}
			title={hasQuery ? m.store_no_results_title() : m.store_explore_title()}
			description={
				hasQuery
					? m.store_no_results_description()
					: m.store_explore_description()
			}
			action={
				activeFilterCount > 0 ? (
					<Button variant="secondary" size="sm" onClick={clearFilters}>
						{m.store_clear_filters()}
					</Button>
				) : undefined
			}
		/>
	) : (
		<>
			<ul className={RESULTS_GRID}>
				{stores.map((store) => (
					<li key={store.id}>
						<StoreTile store={store} showDistance={coords !== null} />
					</li>
				))}
			</ul>
			{hasNextPage && (
				<div className="mt-8 flex justify-center">
					<Button
						variant="secondary"
						onClick={() => fetchNextPage()}
						disabled={isFetchingNextPage}
					>
						{isFetchingNextPage ? m.store_loading() : m.store_load_more()}
					</Button>
				</div>
			)}
		</>
	);

	// I pin possono essere vuoti per due ragioni diverse: zero negozi
	// corrispondono ai filtri (nessun risultato), oppure i negozi ci sono ma
	// nessuno ha una posizione geocodificata (`total > 0 && mappable === 0`,
	// es. una ricerca testuale che pesca un solo negozio senza coordinate).
	// Confondere i due casi mostrerebbe "N negozi" sopra e "nessun negozio
	// trovato" sotto, nella stessa vista.
	const mapEmpty = !map.isPending && map.pins.length === 0;
	const mapAllUnmapped = mapEmpty && map.total > 0 && map.mappable === 0;

	const mapResults = map.isError ? (
		<Notice
			icon={RotateCw}
			title={m.store_map_error_title()}
			description={m.store_map_error_description()}
			action={
				<Button variant="secondary" size="sm" onClick={() => map.refetch()}>
					<RotateCw className="size-4" aria-hidden />
					{m.store_retry()}
				</Button>
			}
		/>
	) : mapAllUnmapped ? (
		<Notice
			icon={MapIcon}
			title={m.store_map_all_unmapped_title()}
			description={m.store_map_all_unmapped_description()}
			action={
				<Button
					variant="secondary"
					size="sm"
					onClick={() => changeView("list")}
				>
					{m.store_view_list()}
				</Button>
			}
		/>
	) : mapEmpty ? (
		<Notice
			icon={MapIcon}
			title={hasQuery ? m.store_no_results_title() : m.store_explore_title()}
			description={
				hasQuery
					? m.store_no_results_description()
					: m.store_explore_description()
			}
			action={
				activeFilterCount > 0 ? (
					<Button variant="secondary" size="sm" onClick={clearFilters}>
						{m.store_clear_filters()}
					</Button>
				) : undefined
			}
		/>
	) : (
		<div className="space-y-2">
			{map.truncated && (
				<p className="text-muted-foreground text-sm">
					{m.store_map_truncated({ count: map.pins.length })}
				</p>
			)}
			{map.total > map.mappable && (
				<p className="text-muted-foreground text-sm">
					{map.total - map.mappable === 1
						? m.store_map_unmapped_one()
						: m.store_map_unmapped({ count: map.total - map.mappable })}
				</p>
			)}
			<section
				aria-label={m.store_map_region()}
				className={`relative isolate overflow-hidden rounded-lg border border-border ${MAP_FRAME}`}
			>
				{hydrated && !map.isPending ? (
					<Suspense
						fallback={
							<div className="size-full animate-pulse bg-muted" aria-hidden />
						}
					>
						<LazyStoreSearchMap
							pins={map.pins}
							showDistance={coords !== null}
							userCoords={coords}
						/>
					</Suspense>
				) : (
					<div className="size-full animate-pulse bg-muted" aria-hidden />
				)}
			</section>
		</div>
	);

	return (
		<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
			<section className="space-y-1">
				<h1 className="font-bold font-display text-2xl text-primary tracking-[-0.015em]">
					{m.store_list_title()}
				</h1>
				<p className="text-muted-foreground text-sm">
					{m.store_list_subtitle()}
				</p>
			</section>

			<div className="mt-6">
				<SearchField
					value={text}
					onChange={setText}
					placeholder={m.store_search_placeholder()}
					ariaLabel={m.store_search_aria()}
					clearLabel={m.store_search_clear()}
				/>
			</div>

			<div className={`mt-8 ${LAYOUT_GRID}`}>
				<aside className="max-lg:hidden">{filters}</aside>

				<div className="@container min-w-0">
					<div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
						<div className="flex min-w-0 items-center gap-3">
							<Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
								<SheetTrigger asChild>
									<Button variant="secondary" size="sm" className="lg:hidden">
										<SlidersHorizontal className="size-4" aria-hidden />
										{m.store_filters()}
										{activeFilterCount > 0 && (
											<span className="-mr-1 ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-primary font-mono text-[0.6875rem] text-primary-foreground tabular-nums">
												{activeFilterCount}
											</span>
										)}
									</Button>
								</SheetTrigger>
								<SheetContent
									side="left"
									className="w-[19rem] gap-0 overflow-y-auto"
								>
									<SheetHeader>
										<SheetTitle>{m.store_filters()}</SheetTitle>
									</SheetHeader>
									<div className="px-4 pb-8">{filters}</div>
								</SheetContent>
							</Sheet>
							<p className="min-w-0 text-muted-foreground text-sm">
								{resultsPending ? (
									<span className="sr-only">{m.store_loading()}</span>
								) : (
									<>
										<span className="font-medium text-foreground">
											{resultsTotal === 1
												? m.store_results_count_one()
												: m.store_results_count({ count: resultsTotal })}
										</span>
										{openNow && ` · ${m.store_open_now()}`}
										{scopeLabel && ` · ${scopeLabel}`}
										{radiusApplies && ` · ${m.store_within_km({ km: radius })}`}
									</>
								)}
							</p>
						</div>
						<div className="flex items-center gap-3">
							{activeFilterCount > 0 && (
								<button
									type="button"
									onClick={clearFilters}
									className="rounded-md text-primary text-sm underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron"
								>
									{m.store_clear_filters()}
								</button>
							)}
							<StoreViewToggle
								value={isMap ? "map" : "list"}
								onChange={changeView}
							/>
						</div>
					</div>

					<div className="mt-4">{isMap ? mapResults : listResults}</div>
				</div>
			</div>
		</div>
	);
}
