import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { ChevronRight, Clock, LocateFixed, MapPin, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { m } from "@/paraglide/messages";
import type { ProductMacroFacetView } from "./use-product-facets";

/** Stesso focus del rail negozi: il saffron da solo non arriva al 3:1, l'Ink porta il contrasto. */
const FOCUS_RING =
	"outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron";

/** Raggi offerti dal rail, in km. `undefined` = nessun limite. */
export const PRODUCT_RADIUS_PRESETS = [1, 3, 5, 10] as const;

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
	value: ProductFilterValue;
	hasOrigin: boolean;
	originLabel: string;
	onChooseOrigin: () => void;
	onChange: (next: ProductFilterValue) => void;
}

function FilterSection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-2">
			<h2 className="font-medium text-[0.8125rem] text-foreground tracking-[0.04em]">
				{title}
			</h2>
			{children}
		</section>
	);
}

function Count({ value }: { value: number }) {
	return (
		<span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
			{value}
		</span>
	);
}

const ROW = `flex min-h-11 w-full items-center gap-2 rounded-md py-2 pr-2 text-left transition-colors lg:min-h-9 ${FOCUS_RING}`;

function CategoryRow({
	label,
	count,
	active,
	depth,
	expandable,
	expanded,
	onClick,
}: {
	label: string;
	count: number;
	active: boolean;
	depth: 0 | 1;
	expandable?: boolean;
	expanded?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-expanded={expandable ? expanded : undefined}
			aria-current={active ? "true" : undefined}
			className={`${ROW} ${depth === 1 ? "pl-8 text-[0.8125rem]" : "pl-2 text-sm"} ${
				active
					? "bg-primary/10 font-medium text-primary"
					: "text-muted-foreground hover:bg-muted hover:text-foreground"
			}`}
		>
			{expandable ? (
				<ChevronRight
					aria-hidden
					className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
						expanded ? "rotate-90" : ""
					}`}
				/>
			) : (
				depth === 0 && (
					<span aria-hidden className="-ml-0.5 size-3.5 shrink-0" />
				)
			)}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<Count value={count} />
		</button>
	);
}

/** `aria-pressed`: qui si accende un filtro, non si sceglie fra alternative. */
function ToggleRow({
	icon: Icon,
	label,
	count,
	active,
	disabled,
	onClick,
}: {
	icon: typeof Clock;
	label: string;
	count: number;
	active: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-pressed={active}
			className={`${ROW} pl-2 text-sm disabled:cursor-not-allowed ${
				active
					? "bg-primary/10 font-medium text-primary"
					: "text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground disabled:opacity-60"
			}`}
		>
			<Icon className="-ml-0.5 size-3.5 shrink-0" aria-hidden />
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<Count value={count} />
		</button>
	);
}

function CategorySkeleton() {
	return (
		<div className="space-y-1.5 py-1" aria-hidden>
			{[72, 58, 80, 64, 70, 54].map((w) => (
				<Skeleton key={w} className="h-6" style={{ width: `${w}%` }} />
			))}
		</div>
	);
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
	value,
	hasOrigin,
	originLabel,
	onChooseOrigin,
	onChange,
}: ProductFiltersProps) {
	const {
		macroCategoryId,
		categoryId,
		radius,
		openNow,
		onSale,
		minPrice,
		maxPrice,
	} = value;

	// La macro aperta è quella che contiene la selezione: nessuno stato
	// separato da tenere in sincrono, e l'URL descrive già tutta la vista.
	const expandedMacroId =
		macroCategoryId ??
		macros.find((mc) => mc.categories.some((c) => c.id === categoryId))?.id;

	return (
		<div className="space-y-7">
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
						{openNowTotal === 0 && (
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
						{onSaleTotal === 0 && (
							<p className="px-2 pt-1 text-muted-foreground text-xs leading-relaxed">
								{m.product_on_sale_none()}
							</p>
						)}
					</div>
				)}
			</FilterSection>

			<FilterSection title={m.product_filter_category()}>
				{isPending ? (
					<CategorySkeleton />
				) : (
					<div className="-mx-2">
						<CategoryRow
							label={m.product_category_all()}
							count={total}
							active={!macroCategoryId && !categoryId}
							depth={0}
							onClick={() =>
								onChange({
									...value,
									macroCategoryId: undefined,
									categoryId: undefined,
								})
							}
						/>
						{macros.map((macro) => {
							const isExpanded = expandedMacroId === macro.id;
							const isActive = macroCategoryId === macro.id && !categoryId;
							return (
								<div key={macro.id}>
									<CategoryRow
										label={macro.name}
										count={macro.productCount}
										active={isActive}
										depth={0}
										expandable
										expanded={isExpanded}
										onClick={() =>
											onChange({
												...value,
												// Ri-cliccare la macro già selezionata la chiude e torna
												// a "Tutte": un solo gesto per aprire e per annullare.
												macroCategoryId: isActive ? undefined : macro.id,
												categoryId: undefined,
											})
										}
									/>
									{isExpanded &&
										macro.categories.map((category) => (
											<CategoryRow
												key={category.id}
												label={category.name}
												count={category.productCount}
												active={categoryId === category.id}
												depth={1}
												onClick={() =>
													onChange({
														...value,
														macroCategoryId: macro.id,
														categoryId:
															categoryId === category.id
																? undefined
																: category.id,
													})
												}
											/>
										))}
								</div>
							);
						})}
					</div>
				)}
			</FilterSection>

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

			<FilterSection title={m.product_filter_distance()}>
				{hasOrigin ? (
					<p className="flex items-center gap-1.5 text-saffron-deep text-xs dark:text-saffron">
						<LocateFixed className="size-3.5 shrink-0" aria-hidden />
						{m.origin_distances_from({ label: originLabel })}
					</p>
				) : (
					<div className="space-y-2.5">
						<p className="text-muted-foreground text-xs leading-relaxed">
							{m.product_distance_needs_origin()}
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
						label={m.product_radius_any()}
						active={hasOrigin && radius === undefined}
						disabled={!hasOrigin}
						onClick={() => onChange({ ...value, radius: undefined })}
					/>
					{PRODUCT_RADIUS_PRESETS.map((km) => (
						<RadiusPill
							key={km}
							label={m.product_radius_km({ km })}
							active={hasOrigin && radius === km}
							disabled={!hasOrigin}
							onClick={() => onChange({ ...value, radius: km })}
						/>
					))}
				</div>
			</FilterSection>
		</div>
	);
}

function RadiusPill({
	label,
	active,
	disabled,
	onClick,
}: {
	label: string;
	active: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex min-h-11 items-center justify-center rounded-full border px-3 font-medium text-xs transition-colors disabled:cursor-not-allowed lg:min-h-7 lg:px-2.5 ${FOCUS_RING} ${
				active
					? "border-primary bg-primary text-primary-foreground"
					: "border-border text-muted-foreground enabled:hover:border-primary/40 enabled:hover:text-foreground disabled:border-dashed"
			}`}
		>
			{label}
		</button>
	);
}
