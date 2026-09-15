import { Button } from "@bibs/ui/components/button";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@bibs/ui/components/sheet";
import { createFileRoute } from "@tanstack/react-router";
import { Compass, RotateCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/notice";
import { PAGE_CONTAINER } from "@/components/page";
import { TileSkeleton } from "@/components/tile";
import { useGeolocation } from "@/features/discovery/use-geolocation";
import type { StoreFilterValue } from "@/features/stores/store-filters";
import { StoreFilters } from "@/features/stores/store-filters";
import { StoreTile } from "@/features/stores/store-tile";
import { useStoreFacets } from "@/features/stores/use-store-facets";
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

/** Tutti i parametri sono opzionali: `/stores` nudo è una vista valida. */
interface StoreSearchParams {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	radius?: number;
	openNow?: boolean;
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
	}),
	component: StoresPage,
});

function StoresPage() {
	const navigate = Route.useNavigate();
	const { q, categoryId, macroCategoryId, radius, openNow } = Route.useSearch();
	const [text, setText] = useState(q ?? "");
	const [filtersOpen, setFiltersOpen] = useState(false);
	const {
		coords,
		status: geoStatus,
		request: requestLocation,
	} = useGeolocation();

	// Debounce the text input into the URL search param.
	useEffect(() => {
		const id = setTimeout(() => {
			void navigate({
				search: (prev) => ({ ...prev, q: text || undefined }),
				replace: true,
			});
		}, 300);
		return () => clearTimeout(id);
	}, [text, navigate]);

	// Sync the controlled input when `q` changes externally (browser back/forward, deep-link).
	const prevQ = useRef(q);
	useEffect(() => {
		if (q !== prevQ.current) {
			prevQ.current = q;
			setText(q ?? "");
		}
	}, [q]);

	const facets = useStoreFacets({ q, coords, radius, openNow });

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
	});

	const filterValue: StoreFilterValue = {
		macroCategoryId,
		categoryId,
		radius,
		openNow,
	};
	// Senza posizione il raggio non viene inviato: contarlo tra i filtri attivi
	// annuncerebbe una restrizione che i risultati non hanno.
	const radiusApplies = radius !== undefined && geoStatus === "granted";
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
			geoStatus={geoStatus}
			onRequestLocation={requestLocation}
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
				<div className="relative">
					<Search
						className="-translate-y-1/2 absolute top-1/2 left-4 size-4.5 text-muted-foreground"
						aria-hidden
					/>
					<input
						type="search"
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder={m.store_search_placeholder()}
						aria-label={m.store_search_aria()}
						className="h-12 w-full rounded-lg border border-border bg-background pr-11 pl-11 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-saffron [&::-webkit-search-cancel-button]:hidden"
					/>
					{text && (
						<button
							type="button"
							onClick={() => setText("")}
							aria-label={m.store_search_clear()}
							className="-translate-y-1/2 absolute top-1/2 right-2 rounded-md p-2 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron"
						>
							<X className="size-4" aria-hidden />
						</button>
					)}
				</div>
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
								{isPending ? (
									<span className="sr-only">{m.store_loading()}</span>
								) : (
									<>
										<span className="font-medium text-foreground">
											{total === 1
												? m.store_results_count_one()
												: m.store_results_count({ count: total })}
										</span>
										{openNow && ` · ${m.store_open_now()}`}
										{scopeLabel && ` · ${scopeLabel}`}
										{radiusApplies && ` · ${m.store_within_km({ km: radius })}`}
									</>
								)}
							</p>
						</div>
						{activeFilterCount > 0 && (
							<button
								type="button"
								onClick={clearFilters}
								className="rounded-md text-primary text-sm underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron"
							>
								{m.store_clear_filters()}
							</button>
						)}
					</div>

					<div className="mt-4">
						{isPending ? (
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
									<Button
										variant="secondary"
										size="sm"
										onClick={() => refetch()}
									>
										<RotateCw className="size-4" aria-hidden />
										{m.store_retry()}
									</Button>
								}
							/>
						) : stores.length === 0 ? (
							<Notice
								icon={Compass}
								title={
									hasQuery
										? m.store_no_results_title()
										: m.store_explore_title()
								}
								description={
									hasQuery
										? m.store_no_results_description()
										: m.store_explore_description()
								}
								action={
									activeFilterCount > 0 ? (
										<Button
											variant="secondary"
											size="sm"
											onClick={clearFilters}
										>
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
											<StoreTile
												store={store}
												showDistance={geoStatus === "granted"}
											/>
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
											{isFetchingNextPage
												? m.store_loading()
												: m.store_load_more()}
										</Button>
									</div>
								)}
							</>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
