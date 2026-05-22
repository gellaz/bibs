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
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAllProductCategories } from "../hooks/use-all-product-categories";

// Converte input utente (it: "5,00") in canonical decimal ("5.00").
// Ritorna undefined se la stringa pulita non matcha il pattern accettato dal backend.
function normalizePrice(raw: string): string | undefined {
	const trimmed = raw.trim().replace(",", ".");
	if (trimmed.length === 0) return undefined;
	if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
	return trimmed;
}

export interface FilterValue {
	categoryIds?: string[];
	minPrice?: string;
	maxPrice?: string;
}

interface ProductsFilterPopoverProps {
	value: FilterValue;
	onChange: (next: FilterValue) => void;
	trigger: ReactNode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ProductsFilterPopover({
	value,
	onChange,
	trigger,
	open,
	onOpenChange,
}: ProductsFilterPopoverProps) {
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
		useAllProductCategories();
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

	const triggerLabel = useMemo(() => {
		if (selectedIds.length === 0) return "Tutte le categorie";
		if (selectedIds.length === 1) {
			return (
				categories.find((c) => c.id === selectedIds[0])?.name ?? "1 categoria"
			);
		}
		const first = categories.find((c) => c.id === selectedIds[0])?.name;
		if (!first) return `${selectedIds.length} categorie`;
		return `${first} +${selectedIds.length - 1}`;
	}, [selectedIds, categories]);

	const toggleCategory = (id: string) => {
		const next = new Set(selectedSet);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		onChange({
			...value,
			categoryIds: next.size === 0 ? undefined : Array.from(next),
		});
	};

	const clearCategories = () => {
		onChange({ ...value, categoryIds: undefined });
	};

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

	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				className="w-80 p-0"
				align="start"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<div className="space-y-4 p-4">
					<div className="space-y-2">
						<Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
							Categoria
						</Label>
						<Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
							<PopoverTrigger asChild>
								<Button
									variant="outline"
									role="combobox"
									aria-expanded={categoryOpen}
									className="w-full justify-between font-normal"
								>
									<span
										className={
											selectedIds.length === 0 ? "text-muted-foreground" : ""
										}
									>
										{catsLoading ? "Caricamento…" : triggerLabel}
									</span>
									<ChevronsUpDownIcon className="text-muted-foreground size-4 shrink-0 opacity-60" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-72 p-0" align="start" sideOffset={4}>
								<Command>
									<CommandInput placeholder="Cerca categoria…" />
									<CommandList className="max-h-64">
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
					</div>

					<div className="space-y-2">
						<Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
							Prezzo
						</Label>
						<div className="grid grid-cols-2 gap-2">
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
					</div>

					<div className="flex justify-end border-t pt-3">
						<Button variant="ghost" size="sm" onClick={handleReset}>
							Reset
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
