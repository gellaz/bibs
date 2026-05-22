import { Button } from "@bibs/ui/components/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@bibs/ui/components/command";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@bibs/ui/components/popover";
import {
	Sheet,
	SheetContent,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@bibs/ui/components/sheet";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSellerCategoriesInUse } from "../hooks/use-seller-categories-in-use";

function normalizePrice(raw: string): string | undefined {
	const trimmed = raw.trim().replace(",", ".");
	if (trimmed.length === 0) return undefined;
	if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
	return trimmed;
}

type StatusFilter = "active" | "disabled" | "trashed";

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
	trigger: ReactNode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const VISIBLE_CHIPS = 2;

export function ProductsFilterSheet({
	value,
	onChange,
	storeId,
	statusFilter,
	trigger,
	open,
	onOpenChange,
}: ProductsFilterSheetProps) {
	const [localMin, setLocalMin] = useState(value.minPrice ?? "");
	const [localMax, setLocalMax] = useState(value.maxPrice ?? "");
	const debouncedMin = useDebouncedValue(localMin, 300);
	const debouncedMax = useDebouncedValue(localMax, 300);
	const [categoryOpen, setCategoryOpen] = useState(false);

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
	type Category = (typeof categories)[number];

	const grouped = useMemo(() => {
		const map = new Map<string, { macroName: string; items: Category[] }>();
		for (const c of categories) {
			const mid = c.macroCategory.id;
			const entry = map.get(mid);
			if (entry) {
				entry.items.push(c);
			} else {
				map.set(mid, { macroName: c.macroCategory.name, items: [c] });
			}
		}
		const arr = Array.from(map.values());
		arr.sort((a, b) => a.macroName.localeCompare(b.macroName, "it"));
		for (const g of arr) {
			g.items.sort((a, b) => a.name.localeCompare(b.name, "it"));
		}
		return arr;
	}, [categories]);

	const selectedIds = value.categoryIds ?? [];
	const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
	const selectedCategories = useMemo(
		() =>
			selectedIds
				.map((id) => categories.find((c) => c.id === id))
				.filter((c): c is Category => Boolean(c)),
		[selectedIds, categories],
	);

	const toggleCategory = (id: string) => {
		const next = new Set(selectedSet);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		onChange({
			...value,
			categoryIds: next.size === 0 ? undefined : Array.from(next),
		});
	};

	const removeCategory = (id: string) => {
		const next = selectedIds.filter((cid) => cid !== id);
		onChange({
			...value,
			categoryIds: next.length === 0 ? undefined : next,
		});
	};

	const clearCategories = () => {
		onChange({ ...value, categoryIds: undefined });
	};

	const visibleChips = selectedCategories.slice(0, VISIBLE_CHIPS);
	const overflowCount = selectedCategories.length - visibleChips.length;
	const noCategoriesAvailable = !catsLoading && categories.length === 0;

	const priceHint = (() => {
		const minN = normalizePrice(localMin);
		const maxN = normalizePrice(localMax);
		if (!minN || !maxN) return null;
		if (Number.parseFloat(minN) > Number.parseFloat(maxN))
			return "Min superiore a max";
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

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetTrigger asChild>{trigger}</SheetTrigger>
			<SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
				<SheetHeader className="border-b px-6 py-4">
					<SheetTitle>Filtri</SheetTitle>
				</SheetHeader>

				<div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
					<section className="space-y-2">
						<Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
							Categoria
						</Label>
						<Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
							<PopoverTrigger asChild>
								<button
									type="button"
									aria-expanded={categoryOpen}
									disabled={noCategoriesAvailable}
									className="border-input dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-9 w-full items-center justify-between gap-1.5 rounded-lg border bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-60"
								>
									<div className="flex flex-wrap items-center gap-1.5">
										{catsLoading && selectedCategories.length === 0 && (
											<span className="text-muted-foreground">
												Caricamento…
											</span>
										)}
										{!catsLoading && selectedCategories.length === 0 && (
											<span className="text-muted-foreground">
												{noCategoriesAvailable
													? "Nessuna categoria nel catalogo"
													: "Seleziona categorie…"}
											</span>
										)}
										{visibleChips.map((cat) => (
											<span
												key={cat.id}
												className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
											>
												{cat.name}
												{/* biome-ignore lint/a11y/useSemanticElements: nested <button> inside the picker trigger button is invalid HTML; span with role keeps the X interactive without DOM nesting issues. */}
												<span
													role="button"
													tabIndex={0}
													aria-label={`Rimuovi ${cat.name}`}
													className="hover:bg-primary-foreground/20 -mr-0.5 flex size-3.5 items-center justify-center rounded-full"
													onClick={(e) => {
														e.stopPropagation();
														removeCategory(cat.id);
													}}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															e.stopPropagation();
															removeCategory(cat.id);
														}
													}}
												>
													<XIcon className="size-3" />
												</span>
											</span>
										))}
										{overflowCount > 0 && (
											<span className="text-muted-foreground text-xs">
												+{overflowCount}
											</span>
										)}
									</div>
									<ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
								</button>
							</PopoverTrigger>
							<PopoverContent
								className="w-(--radix-popover-trigger-width) p-0"
								align="start"
								sideOffset={4}
							>
								<Command>
									<CommandInput placeholder="Cerca categoria…" />
									<CommandList className="max-h-72">
										<CommandEmpty>Nessuna categoria.</CommandEmpty>
										{selectedIds.length > 0 && (
											<CommandGroup>
												<CommandItem
													value="__clear__"
													onSelect={() => clearCategories()}
													className="text-muted-foreground"
												>
													<div className="flex w-4 items-center" />
													Cancella selezione ({selectedIds.length})
												</CommandItem>
											</CommandGroup>
										)}
										{grouped.map((g) => (
											<CommandGroup key={g.macroName} heading={g.macroName}>
												{g.items.map((c) => {
													const isOn = selectedSet.has(c.id);
													return (
														<CommandItem
															key={c.id}
															value={`${c.name} ${g.macroName}`}
															onSelect={() => toggleCategory(c.id)}
														>
															<div className="flex w-4 items-center">
																{isOn && (
																	<CheckIcon className="text-primary size-4" />
																)}
															</div>
															{c.name}
														</CommandItem>
													);
												})}
											</CommandGroup>
										))}
									</CommandList>
								</Command>
							</PopoverContent>
						</Popover>
					</section>

					<section className="space-y-2">
						<Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
							Prezzo
						</Label>
						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1">
								<Label htmlFor="filter-min-price" className="text-xs">
									Min
								</Label>
								<div className="relative">
									<Input
										id="filter-min-price"
										inputMode="decimal"
										placeholder="0,00"
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
									Max
								</Label>
								<div className="relative">
									<Input
										id="filter-max-price"
										inputMode="decimal"
										placeholder="0,00"
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

				<SheetFooter className="border-t px-6 py-3">
					<Button
						variant="ghost"
						onClick={handleReset}
						disabled={!hasActiveFilters}
					>
						Cancella tutti i filtri
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
