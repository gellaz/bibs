import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import { Input } from "@bibs/ui/components/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@bibs/ui/components/sheet";
import { Switch } from "@bibs/ui/components/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface Props {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	excludeDiscountId?: string;
	alreadySelectedIds?: Set<string>;
	onConfirm: (productIds: string[]) => void;
}

export function ProductPickerSheet({
	open,
	onOpenChange,
	excludeDiscountId,
	alreadySelectedIds,
	onConfirm,
}: Props) {
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 300);
	const [minPrice, setMinPrice] = useState("");
	const [maxPrice, setMaxPrice] = useState("");
	const [inStock, setInStock] = useState(true);
	const [includeDisabled, setIncludeDisabled] = useState(false);
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const { data } = useQuery({
		queryKey: [
			"product-picker",
			debouncedSearch,
			minPrice,
			maxPrice,
			inStock,
			includeDisabled,
			excludeDiscountId,
		],
		queryFn: async () => {
			const res = await api().seller.products.get({
				query: {
					page: 1,
					limit: 100,
					statusFilter: includeDisabled ? "disabled" : "active",
					minPrice: minPrice || undefined,
					maxPrice: maxPrice || undefined,
					inStock: inStock || undefined,
					excludeDiscountId,
				},
			});
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
		enabled: open,
	});

	const rows = data?.data ?? [];
	const visibleRows = useMemo(() => {
		if (!debouncedSearch) return rows;
		const q = debouncedSearch.toLowerCase();
		return rows.filter((r) => r.name.toLowerCase().includes(q));
	}, [rows, debouncedSearch]);
	const visibleIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);
	const allVisibleSelected =
		visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

	function toggleOne(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleAllVisible() {
		setSelected((prev) => {
			const next = new Set(prev);
			if (allVisibleSelected) for (const id of visibleIds) next.delete(id);
			else for (const id of visibleIds) next.add(id);
			return next;
		});
	}

	function resetFilters() {
		setSearch("");
		setMinPrice("");
		setMaxPrice("");
		setInStock(true);
		setIncludeDisabled(false);
	}

	function confirm() {
		onConfirm(Array.from(selected));
		setSelected(new Set());
		onOpenChange(false);
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="flex w-full flex-col p-0 sm:max-w-2xl"
			>
				<SheetHeader className="p-6 pb-2">
					<SheetTitle>{m.promotions_picker_title()}</SheetTitle>
					<SheetDescription />
				</SheetHeader>

				<div className="space-y-3 border-b px-6 pb-4">
					<Input
						placeholder={m.promotions_picker_search_placeholder()}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
					<div className="grid grid-cols-2 gap-2">
						<Input
							type="number"
							placeholder={m.promotions_picker_filter_price_min()}
							value={minPrice}
							onChange={(e) => setMinPrice(e.target.value)}
						/>
						<Input
							type="number"
							placeholder={m.promotions_picker_filter_price_max()}
							value={maxPrice}
							onChange={(e) => setMaxPrice(e.target.value)}
						/>
					</div>
					<div className="flex items-center justify-between gap-3 text-sm">
						<div className="inline-flex items-center gap-2">
							<Switch
								id="picker-in-stock"
								checked={inStock}
								onCheckedChange={setInStock}
							/>
							<label htmlFor="picker-in-stock">
								{m.promotions_picker_filter_in_stock()}
							</label>
						</div>
						<div className="inline-flex items-center gap-2">
							<Switch
								id="picker-include-disabled"
								checked={includeDisabled}
								onCheckedChange={setIncludeDisabled}
							/>
							<label htmlFor="picker-include-disabled">
								{m.promotions_picker_filter_include_disabled()}
							</label>
						</div>
						<Button variant="ghost" size="sm" onClick={resetFilters}>
							{m.promotions_picker_reset_filters()}
						</Button>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto px-6 py-4">
					<div className="mb-2 flex items-center justify-between text-sm">
						<Button variant="link" size="sm" onClick={toggleAllVisible}>
							{allVisibleSelected
								? m.promotions_picker_deselect_all()
								: m.promotions_picker_select_all()}
						</Button>
					</div>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-10" />
								<TableHead>Nome</TableHead>
								<TableHead>Prezzo</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{visibleRows.map((r) => {
								const isAlready = !!alreadySelectedIds?.has(r.id);
								return (
									<TableRow key={r.id}>
										<TableCell>
											<Checkbox
												checked={isAlready || selected.has(r.id)}
												disabled={isAlready}
												onCheckedChange={() => toggleOne(r.id)}
											/>
										</TableCell>
										<TableCell>{r.name}</TableCell>
										<TableCell>€{r.price}</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>

				<SheetFooter className="border-t px-6 py-4">
					<div className="flex w-full items-center justify-between">
						<span className="text-muted-foreground text-sm">
							{m.promotions_picker_selected_count({ count: selected.size })}
						</span>
						<Button onClick={confirm} disabled={selected.size === 0}>
							{m.promotions_picker_add_cta()}
						</Button>
					</div>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
