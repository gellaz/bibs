import { Button } from "@bibs/ui/components/button";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@bibs/ui/components/sheet";
import { createFileRoute } from "@tanstack/react-router";
import { Compass, RotateCw, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Notice } from "@/components/notice";
import { PAGE_CONTAINER } from "@/components/page";
import { TileSkeleton } from "@/components/tile";
import { AddToCart } from "@/features/cart/add-to-cart";
import type { ProductFilterValue } from "@/features/catalog/product-filters";
import { ProductFilters } from "@/features/catalog/product-filters";
import { ProductTile } from "@/features/catalog/product-tile";
import { useProductFacets } from "@/features/catalog/use-product-facets";
import { useProductSearch } from "@/features/catalog/use-product-search";
import { originLabel } from "@/features/location/origin-label";
import { useSearchOrigin } from "@/features/location/search-origin";
import { useNearParam } from "@/features/location/use-near-param";
import { SearchField } from "@/features/search/search-field";
import { useSearchTextParam } from "@/features/search/use-search-text-param";
import { m } from "@/paraglide/messages";

/**
 * Rail a sinistra e risultati a destra da `lg`; sotto, i filtri finiscono in
 * un pannello. `items-start` tiene il rail alla sua altezza invece di stirarlo
 * per tutta la colonna dei risultati. Stesse misure di `/stores`: sono la
 * stessa pagina vista da un'altra angolazione, e due larghezze diverse si
 * noterebbero passando dall'una all'altra.
 */
const LAYOUT_GRID =
	"grid items-start gap-x-8 gap-y-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:gap-x-10 xl:grid-cols-[17rem_minmax(0,1fr)]";

/** La griglia vive in una colonna più stretta della pagina: container query, non viewport. */
const RESULTS_GRID =
	"grid grid-cols-2 gap-x-4 gap-y-6 @xl:grid-cols-3 @4xl:grid-cols-4";

/** Tutti i parametri sono opzionali: `/products` nudo è una vista valida. */
interface ProductSearchParams {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	radius?: number;
	openNow?: boolean;
	onSale?: boolean;
	minPrice?: number;
	maxPrice?: number;
	/**
	 * Da dove si cerca: `gps` o l'id di un indirizzo. Mai coordinate — un link
	 * condiviso non deve dire dove abiti.
	 */
	near?: string;
}

export const Route = createFileRoute("/_authenticated/products/")({
	validateSearch: (search: Record<string, unknown>): ProductSearchParams => ({
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
		onSale: search.onSale === true ? true : undefined,
		minPrice: typeof search.minPrice === "number" ? search.minPrice : undefined,
		maxPrice: typeof search.maxPrice === "number" ? search.maxPrice : undefined,
		near: typeof search.near === "string" ? search.near : undefined,
	}),
	component: ProductsPage,
});

function ProductsPage() {
	const navigate = Route.useNavigate();
	const {
		q,
		categoryId,
		macroCategoryId,
		radius,
		openNow,
		onSale,
		minPrice,
		maxPrice,
		near,
	} = Route.useSearch();
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

	const facets = useProductFacets({
		q,
		coords,
		radius,
		openNow,
		onSale,
		minPrice,
		maxPrice,
	});

	const {
		products,
		total,
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
		isPending,
		isError,
		refetch,
	} = useProductSearch({
		q,
		categoryId,
		macroCategoryId,
		coords,
		radius,
		openNow,
		onSale,
		minPrice,
		maxPrice,
	});

	const filterValue: ProductFilterValue = {
		macroCategoryId,
		categoryId,
		radius,
		openNow,
		onSale,
		minPrice,
		maxPrice,
	};

	// Senza posizione il raggio non viene inviato: contarlo fra i filtri attivi
	// annuncerebbe una restrizione che i risultati non hanno.
	const radiusApplies = radius !== undefined && coords !== null;
	const activeFilterCount =
		(categoryId || macroCategoryId ? 1 : 0) +
		(radiusApplies ? 1 : 0) +
		(openNow ? 1 : 0) +
		(onSale ? 1 : 0) +
		(minPrice !== undefined || maxPrice !== undefined ? 1 : 0);
	const hasQuery = Boolean(q) || activeFilterCount > 0;

	const applyFilters = (next: ProductFilterValue) => {
		void navigate({
			search: (prev) => ({
				...prev,
				macroCategoryId: next.macroCategoryId,
				categoryId: next.categoryId,
				radius: next.radius,
				openNow: next.openNow || undefined,
				onSale: next.onSale || undefined,
				minPrice: next.minPrice,
				maxPrice: next.maxPrice,
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
			onSale: undefined,
			minPrice: undefined,
			maxPrice: undefined,
		});

	const filters = (
		<ProductFilters
			macros={facets.macros}
			total={facets.total}
			openNowTotal={facets.openNowTotal}
			onSaleTotal={facets.onSaleTotal}
			isPending={facets.isPending}
			value={filterValue}
			hasOrigin={coords !== null}
			originLabel={originLabel(origin, geoStatus)}
			onChooseOrigin={() => setPickerOpen(true)}
			onChange={applyFilters}
		/>
	);

	// Nome del filtro attivo per la riga dei risultati: sotto `lg` è l'unico
	// posto in cui si legge cosa è selezionato, il rail è chiuso.
	const activeMacro = facets.macros.find((mc) => mc.id === macroCategoryId);
	const activeCategoryName =
		activeMacro?.categories.find((c) => c.id === categoryId)?.name ??
		facets.macros
			.flatMap((mc) => mc.categories)
			.find((c) => c.id === categoryId)?.name;
	const scopeLabel = activeCategoryName ?? activeMacro?.name;

	const results = isPending ? (
		<div className={RESULTS_GRID} aria-hidden>
			{Array.from({ length: 8 }, (_, i) => (
				<TileSkeleton key={`tile-skeleton-${i}`} />
			))}
		</div>
	) : isError ? (
		<Notice
			icon={RotateCw}
			title={m.product_load_error_title()}
			description={m.product_load_error_description()}
			action={
				<Button variant="secondary" size="sm" onClick={() => refetch()}>
					<RotateCw className="size-4" aria-hidden />
					{m.product_retry()}
				</Button>
			}
		/>
	) : products.length === 0 ? (
		<Notice
			icon={Compass}
			title={
				hasQuery ? m.product_no_results_title() : m.product_explore_title()
			}
			description={
				hasQuery
					? m.product_no_results_description()
					: m.product_explore_description()
			}
			action={
				activeFilterCount > 0 ? (
					<Button variant="secondary" size="sm" onClick={clearFilters}>
						{m.product_clear_filters()}
					</Button>
				) : undefined
			}
		/>
	) : (
		<>
			<ul className={RESULTS_GRID}>
				{products.map((product) => (
					<li key={product.id}>
						<ProductTile
							product={product}
							showDistance={coords !== null}
							action={
								<AddToCart
									storeProductId={product.storeProductId}
									stock={product.stock}
									productName={product.name}
								/>
							}
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
						{isFetchingNextPage ? m.product_loading() : m.product_load_more()}
					</Button>
				</div>
			)}
		</>
	);

	return (
		<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
			<section className="space-y-1">
				<h1 className="font-bold font-display text-2xl text-primary tracking-[-0.015em]">
					{m.product_list_title()}
				</h1>
				<p className="text-muted-foreground text-sm">
					{m.product_list_subtitle()}
				</p>
			</section>

			<div className="mt-6">
				<SearchField
					value={text}
					onChange={setText}
					placeholder={m.product_search_placeholder()}
					ariaLabel={m.product_search_aria()}
					clearLabel={m.product_search_clear()}
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
										{m.product_filters()}
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
										<SheetTitle>{m.product_filters()}</SheetTitle>
									</SheetHeader>
									<div className="px-4 pb-8">{filters}</div>
								</SheetContent>
							</Sheet>
							<p className="min-w-0 text-muted-foreground text-sm">
								{isPending ? (
									<span className="sr-only">{m.product_loading()}</span>
								) : (
									<>
										<span className="font-medium text-foreground">
											{total === 1
												? m.product_results_count_one()
												: m.product_results_count({ count: total })}
										</span>
										{openNow && ` · ${m.product_open_now()}`}
										{onSale && ` · ${m.product_on_sale()}`}
										{scopeLabel && ` · ${scopeLabel}`}
										{radiusApplies &&
											` · ${m.product_within_km({ km: radius })}`}
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
								{m.product_clear_filters()}
							</button>
						)}
					</div>

					<div className="mt-4">{results}</div>
				</div>
			</div>
		</div>
	);
}
