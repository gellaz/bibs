import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { Separator } from "@bibs/ui/components/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@bibs/ui/components/sheet";
import { SelectCombobox } from "@bibs/ui/custom/select-combobox";
import { useDebouncedValue } from "@bibs/ui/hooks/use-debounced-value";
import {
	EuroIcon,
	FilterIcon,
	type LucideIcon,
	SlidersHorizontalIcon,
	TagIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { m } from "@/paraglide/messages";
import { useSellerCategoriesInUse } from "../hooks/use-seller-categories-in-use";

function normalizePrice(raw: string): string | undefined {
	const trimmed = raw.trim().replace(",", ".");
	if (trimmed.length === 0) return undefined;
	if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
	return trimmed;
}

type StatusFilter = "active" | "disabled" | "trashed";

/** Sommario della sezione Categoria: niente testo senza selezione. */
export function selectedCategoriesLabel(count: number): string | undefined {
	if (count === 0) return undefined;
	return count === 1
		? m.products_filter_category_selected_one()
		: m.products_filter_category_selected({ count });
}

/** Piede del pannello: quanti filtri sono attivi. */
export function activeFiltersLabel(count: number): string {
	if (count === 0) return m.products_filter_active_none();
	return count === 1
		? m.products_filter_active_one()
		: m.products_filter_active({ count });
}

export interface FilterValue {
	categoryIds?: string[];
	minPrice?: string;
	maxPrice?: string;
}

interface ProductsFilterSheetProps {
	value: FilterValue;
	onChange: (next: FilterValue) => void;
	storeId: string | undefined;
	statusFilter: StatusFilter | undefined;
	totalResults: number | undefined;
}

function ResultSummary({ count }: { count: number | undefined }) {
	if (count === undefined) {
		return (
			<SheetDescription className="text-muted-foreground/70">
				{m.products_filter_loading()}
			</SheetDescription>
		);
	}
	if (count === 0) {
		return (
			<SheetDescription>{m.products_filter_summary_empty()}</SheetDescription>
		);
	}
	return (
		<SheetDescription>
			<span className="tabular-nums font-medium text-foreground">{count}</span>{" "}
			{count === 1
				? m.products_filter_summary_one()
				: m.products_filter_summary()}
		</SheetDescription>
	);
}

interface SectionHeaderProps {
	icon: LucideIcon;
	label: string;
	active: boolean;
	summary?: string;
	onClear?: () => void;
}

function SectionHeader({
	icon: Icon,
	label,
	active,
	summary,
	onClear,
}: SectionHeaderProps) {
	return (
		<div className="flex items-center justify-between gap-3">
			<div className="flex items-center gap-2.5">
				<span
					aria-hidden
					className={
						active
							? "bg-cobalt-soft text-cobalt-deep flex size-6 shrink-0 items-center justify-center rounded-md"
							: "text-muted-foreground/70 flex size-6 shrink-0 items-center justify-center"
					}
				>
					<Icon className="size-3.5" />
				</span>
				<Label className="text-muted-foreground text-xs font-medium tracking-[0.08em] uppercase">
					{label}
				</Label>
				{summary && (
					<span className="text-muted-foreground/70 text-xs">{summary}</span>
				)}
			</div>
			{active && onClear && (
				<button
					type="button"
					onClick={onClear}
					className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
				>
					{m.products_filter_clear_section()}
				</button>
			)}
		</div>
	);
}

export function ProductsFilterSheet({
	value,
	onChange,
	storeId,
	statusFilter,
	totalResults,
}: ProductsFilterSheetProps) {
	const [open, setOpen] = useState(false);
	const [localMin, setLocalMin] = useState(value.minPrice ?? "");
	const [localMax, setLocalMax] = useState(value.maxPrice ?? "");
	const debouncedMin = useDebouncedValue(localMin, 300);
	const debouncedMax = useDebouncedValue(localMax, 300);

	useEffect(() => {
		setLocalMin(value.minPrice ?? "");
	}, [value.minPrice]);
	useEffect(() => {
		setLocalMax(value.maxPrice ?? "");
	}, [value.maxPrice]);

	useEffect(() => {
		const normalized = normalizePrice(debouncedMin);
		if (normalized === value.minPrice) return;
		onChange({ ...value, minPrice: normalized });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debouncedMin]);
	useEffect(() => {
		const normalized = normalizePrice(debouncedMax);
		if (normalized === value.maxPrice) return;
		onChange({ ...value, maxPrice: normalized });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debouncedMax]);

	const { data: categories = [], isLoading: catsLoading } =
		useSellerCategoriesInUse(storeId, statusFilter);

	// Gruppi per macro, macro e categorie in ordine alfabetico.
	const categoryOptions = useMemo(
		() =>
			categories
				.map((c) => ({
					value: c.id,
					label: c.name,
					group: c.macroCategory.name,
				}))
				.sort(
					(a, b) =>
						a.group.localeCompare(b.group, "it") ||
						a.label.localeCompare(b.label, "it"),
				),
		[categories],
	);

	const selectedIds = value.categoryIds ?? [];

	const clearCategories = () => {
		onChange({ ...value, categoryIds: undefined });
	};

	const noCategoriesAvailable = !catsLoading && categories.length === 0;

	const priceHint = (() => {
		const minN = normalizePrice(localMin);
		const maxN = normalizePrice(localMax);
		if (!minN || !maxN) return null;
		if (Number.parseFloat(minN) > Number.parseFloat(maxN))
			return m.products_filter_price_min_over_max();
		return null;
	})();

	const handleReset = () => {
		setLocalMin("");
		setLocalMax("");
		onChange({});
	};

	const hasActiveFilters =
		selectedIds.length > 0 ||
		Boolean(value.minPrice) ||
		Boolean(value.maxPrice);
	const activeCount =
		selectedIds.length + (value.minPrice ? 1 : 0) + (value.maxPrice ? 1 : 0);

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button variant="outline" className="relative gap-2">
					<FilterIcon className="size-4" />
					{m.products_filter_title()}
					{activeCount > 0 && (
						<span
							role="status"
							aria-label={m.products_filter_active_badge({
								count: activeCount,
							})}
							className="bg-cobalt-soft text-cobalt-deep ring-background absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2"
						>
							{activeCount}
						</span>
					)}
				</Button>
			</SheetTrigger>
			<SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
				<SheetHeader className="border-b px-6 py-5">
					<div className="flex items-stretch gap-3">
						<span
							aria-hidden
							className="bg-cobalt-soft text-cobalt-deep flex aspect-square shrink-0 items-center justify-center self-stretch rounded-lg"
						>
							<SlidersHorizontalIcon className="size-5" />
						</span>
						<div className="flex flex-col justify-center gap-0.5">
							<SheetTitle className="text-base leading-none">
								{m.products_filter_title()}
							</SheetTitle>
							<ResultSummary count={totalResults} />
						</div>
					</div>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto">
					<section className="space-y-3 px-6 py-5">
						<SectionHeader
							icon={TagIcon}
							label={m.products_filter_category()}
							active={selectedIds.length > 0}
							summary={selectedCategoriesLabel(selectedIds.length)}
							onClear={clearCategories}
						/>
						<SelectCombobox
							multiple
							aria-label={m.products_filter_category()}
							options={categoryOptions}
							value={selectedIds}
							onChange={(ids) =>
								onChange({
									...value,
									categoryIds: ids.length === 0 ? undefined : ids,
								})
							}
							placeholder={
								catsLoading
									? m.products_filter_loading()
									: noCategoriesAvailable
										? m.products_filter_category_none_in_catalog()
										: m.products_filter_category_placeholder()
							}
							emptyText={m.products_filter_category_empty()}
							clearLabel={(name) => m.common_remove_named({ name })}
							disabled={catsLoading || noCategoriesAvailable}
						/>
					</section>

					<Separator />

					<section className="space-y-3 px-6 py-5">
						<SectionHeader
							icon={EuroIcon}
							label={m.products_filter_price()}
							active={Boolean(value.minPrice || value.maxPrice)}
							summary={(() => {
								if (value.minPrice && value.maxPrice)
									return `${value.minPrice}–${value.maxPrice} €`;
								if (value.minPrice)
									return m.products_filter_price_from({ min: value.minPrice });
								if (value.maxPrice)
									return m.products_filter_price_to({ max: value.maxPrice });
								return undefined;
							})()}
							onClear={
								value.minPrice || value.maxPrice
									? () => {
											setLocalMin("");
											setLocalMax("");
											onChange({
												...value,
												minPrice: undefined,
												maxPrice: undefined,
											});
										}
									: undefined
							}
						/>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1">
								<Label htmlFor="filter-min-price" className="text-xs">
									{m.products_filter_price_min()}
								</Label>
								<div className="relative">
									<Input
										id="filter-min-price"
										inputMode="decimal"
										placeholder={m.products_filter_price_placeholder()}
										value={localMin}
										onChange={(e) => setLocalMin(e.target.value)}
										className="pr-7"
									/>
									<span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-sm">
										€
									</span>
								</div>
							</div>
							<div className="space-y-1">
								<Label htmlFor="filter-max-price" className="text-xs">
									{m.products_filter_price_max()}
								</Label>
								<div className="relative">
									<Input
										id="filter-max-price"
										inputMode="decimal"
										placeholder={m.products_filter_price_placeholder()}
										value={localMax}
										onChange={(e) => setLocalMax(e.target.value)}
										className="pr-7"
									/>
									<span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-sm">
										€
									</span>
								</div>
							</div>
						</div>
						{priceHint && (
							<p className="text-destructive text-xs">{priceHint}</p>
						)}
					</section>
				</div>

				<SheetFooter className="flex-row items-center justify-between border-t px-6 py-3">
					<p className="text-muted-foreground text-xs">
						{activeFiltersLabel(activeCount)}
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={handleReset}
						disabled={!hasActiveFilters}
						className="gap-1.5"
					>
						<XIcon className="size-3.5" />
						{m.products_filter_clear_all()}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
