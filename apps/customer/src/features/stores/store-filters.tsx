import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { ChevronRight, Clock, LocateFixed, MapPin } from "lucide-react";
import type { GeoStatus } from "@/features/discovery/use-geolocation";
import { m } from "@/paraglide/messages";
import type { MacroFacet } from "./use-store-facets";

/**
 * Focus del register brand: alone saffron con l'anello Ink appena fuori. Il
 * saffron da solo non arriva al 3:1 richiesto a un indicatore di focus, è
 * l'Ink a portare il contrasto (The Focus Contrast Rule in DESIGN.md).
 */
const FOCUS_RING =
	"outline-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron";

/** Raggi offerti dalla sidebar, in km. `undefined` = nessun limite. */
export const RADIUS_PRESETS = [1, 3, 5, 10] as const;

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
	value: StoreFilterValue;
	geoStatus: GeoStatus;
	onRequestLocation: () => void;
	onChange: (next: StoreFilterValue) => void;
}

/**
 * Intestazione di sezione del rail: la stessa voce sottile della scheda
 * negozio — il peso tipografico resta ai risultati, non ai filtri.
 */
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

/** Conteggio a destra di una riga: misura, quindi mono e tabellare. */
function Count({ value }: { value: number }) {
	return (
		<span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
			{value}
		</span>
	);
}

const ROW = `flex min-h-11 w-full items-center gap-2 rounded-md py-2 pr-2 text-left transition-colors lg:min-h-9 ${FOCUS_RING}`;

/**
 * Riga di categoria. Lo stato attivo è Ink (tinta + testo): sul customer il
 * saffron è riservato ai momenti-segnale (ricompensa, civico, presenza), la
 * selezione di un filtro non è uno di quelli.
 */
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

/**
 * Riga a interruttore: stessa geometria di `CategoryRow` — è lo stesso gesto
 * nello stesso rail — ma `aria-pressed`, perché qui si accende un filtro
 * invece di scegliere fra alternative. A zero resta visibile e spenta: "nessuno
 * aperto adesso" è una risposta, non rumore da nascondere.
 */
function ToggleRow({
	label,
	count,
	active,
	disabled,
	onClick,
}: {
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
			<Clock className="-ml-0.5 size-3.5 shrink-0" aria-hidden />
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
 * Rail dei filtri: disponibilità, categoria (macro → categoria) e distanza. Lo
 * stesso nodo serve il rail da `lg` e il pannello mobile, quindi non porta
 * larghezza né posizionamento propri.
 */
export function StoreFilters({
	macros,
	total,
	openNowTotal,
	isPending,
	value,
	geoStatus,
	onRequestLocation,
	onChange,
}: StoreFiltersProps) {
	const { macroCategoryId, categoryId, radius, openNow } = value;

	// La macro aperta è quella che contiene la selezione: nessuno stato
	// separato da tenere in sincrono, e l'URL descrive già tutta la vista.
	const expandedMacroId =
		macroCategoryId ??
		macros.find((mc) => mc.categories.some((c) => c.id === categoryId))?.id;

	const hasPosition = geoStatus === "granted";

	return (
		<div className="space-y-7">
			<FilterSection title={m.store_filter_availability()}>
				{isPending ? (
					<Skeleton className="h-6 w-2/5" />
				) : (
					<div className="-mx-2">
						<ToggleRow
							label={m.store_open_now()}
							count={openNowTotal}
							active={openNow === true}
							// A zero il filtro garantisce la lista vuota; resta cliccabile
							// solo se è già acceso, altrimenti non si potrebbe spegnere.
							disabled={openNowTotal === 0 && openNow !== true}
							onClick={() => onChange({ ...value, openNow: !openNow })}
						/>
						{openNowTotal === 0 && (
							// Vero esattamente quanto il conteggio: misurato su testo e
							// raggio, non sulla categoria scelta.
							<p className="px-2 pt-1 text-muted-foreground text-xs leading-relaxed">
								{m.store_open_now_none()}
							</p>
						)}
					</div>
				)}
			</FilterSection>

			<FilterSection title={m.store_filter_category()}>
				{isPending ? (
					<CategorySkeleton />
				) : (
					<div className="-mx-2">
						<CategoryRow
							label={m.store_category_all()}
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
										count={macro.storeCount}
										active={isActive}
										depth={0}
										expandable
										expanded={isExpanded}
										onClick={() =>
											onChange({
												...value,
												// Ri-cliccare la macro già selezionata la chiude e
												// torna a "Tutte": un solo gesto per aprire e per
												// annullare.
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
												count={category.storeCount}
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

			<FilterSection title={m.store_filter_distance()}>
				{hasPosition ? (
					<p className="flex items-center gap-1.5 text-saffron-deep text-xs dark:text-saffron">
						<LocateFixed className="size-3.5 shrink-0" aria-hidden />
						{m.store_sorted_by_distance()}
					</p>
				) : (
					<div className="space-y-2.5">
						<p className="text-muted-foreground text-xs leading-relaxed">
							{m.store_distance_needs_location()}
						</p>
						<Button
							variant="secondary"
							size="sm"
							onClick={onRequestLocation}
							disabled={geoStatus === "pending"}
						>
							<MapPin className="size-4" aria-hidden />
							{geoStatus === "pending"
								? m.store_locating()
								: m.store_use_my_location()}
						</Button>
					</div>
				)}

				<div className="grid grid-cols-3 gap-2 pt-1 lg:flex lg:flex-wrap lg:gap-1.5">
					<RadiusPill
						label={m.store_radius_any()}
						active={hasPosition && radius === undefined}
						disabled={!hasPosition}
						onClick={() => onChange({ ...value, radius: undefined })}
					/>
					{RADIUS_PRESETS.map((km) => (
						<RadiusPill
							key={km}
							label={m.store_radius_km({ km })}
							active={hasPosition && radius === km}
							disabled={!hasPosition}
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
