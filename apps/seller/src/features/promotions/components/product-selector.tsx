import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { formatPriceEur } from "@bibs/ui/components/price";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { Switch } from "@bibs/ui/components/switch";
import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { cn } from "@bibs/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	useAddDiscountProducts,
	useRemoveDiscountProducts,
} from "@/features/promotions/hooks/use-discounts";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

interface NormalizedProduct {
	id: string;
	name: string;
	originalPrice: string;
	categoryNames: string[];
}

type LocalMode = {
	kind: "local";
	percent: number;
	includedIds: string[];
	onChange: (next: string[]) => void;
};

type MutateMode = {
	kind: "mutate";
	discountId: string;
	percent: number;
};

export interface ProductSelectorProps {
	mode: LocalMode | MutateMode;
}

type View = "all" | "included";

const INCLUDED_LIMIT = 100;

function applyPercent(originalPrice: string, percent: number): string {
	const n = Number.parseFloat(originalPrice);
	if (!Number.isFinite(n)) return originalPrice;
	return (n * (1 - percent / 100)).toFixed(2);
}

export function ProductSelector({ mode }: ProductSelectorProps) {
	const queryClient = useQueryClient();
	const [view, setView] = useState<View>("all");
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 300);
	const [minPrice, setMinPrice] = useState("");
	const [maxPrice, setMaxPrice] = useState("");
	const [inStock, setInStock] = useState(false);
	const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
	const [productCache, setProductCache] = useState<
		Map<string, NormalizedProduct>
	>(new Map());

	const libraryQuery = useQuery({
		queryKey: ["product-selector", "library", minPrice, maxPrice, inStock],
		queryFn: async () => {
			const res = await api().seller.products.get({
				query: {
					page: 1,
					limit: 100,
					statusFilter: "active",
					minPrice: minPrice || undefined,
					maxPrice: maxPrice || undefined,
					inStock: inStock || undefined,
				},
			});
			if (res.error) throw new Error(res.error.value?.message || "Errore");
			return res.data;
		},
	});

	const allRows = useMemo<NormalizedProduct[]>(() => {
		return (libraryQuery.data?.data ?? []).map((p) => ({
			id: p.id,
			name: p.name,
			originalPrice: p.price,
			categoryNames: p.productCategoryAssignments
				.map((a) => a.category?.name)
				.filter((n): n is string => Boolean(n)),
		}));
	}, [libraryQuery.data]);

	useEffect(() => {
		if (allRows.length === 0) return;
		setProductCache((prev) => {
			let changed = false;
			const next = new Map(prev);
			for (const p of allRows) {
				if (!next.has(p.id)) {
					next.set(p.id, p);
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [allRows]);

	const includedQueryKey = useMemo(
		() =>
			mode.kind === "mutate"
				? ([
						"discounts",
						"products",
						mode.discountId,
						1,
						INCLUDED_LIMIT,
					] as const)
				: undefined,
		[mode],
	);

	const includedQuery = useQuery({
		queryKey: includedQueryKey ?? ["discounts", "products", "noop"],
		queryFn: async () => {
			if (mode.kind !== "mutate") throw new Error("noop");
			const res = await api()
				.seller.discounts({ discountId: mode.discountId })
				.products.get({ query: { page: 1, limit: INCLUDED_LIMIT } });
			if (res.error)
				throw new Error(res.error.value?.message || "Errore caricamento");
			return res.data;
		},
		enabled: mode.kind === "mutate",
	});

	const addMutation = useAddDiscountProducts(
		mode.kind === "mutate" ? mode.discountId : "",
	);
	const removeMutation = useRemoveDiscountProducts(
		mode.kind === "mutate" ? mode.discountId : "",
	);

	// Set of currently-included product IDs (source of truth depends on mode)
	const includedIds = useMemo<Set<string>>(() => {
		if (mode.kind === "local") return new Set(mode.includedIds);
		return new Set((includedQuery.data?.data ?? []).map((r) => r.id));
	}, [mode, includedQuery.data]);

	// Server-provided discounted prices in mutate mode (avoids rounding drift)
	const serverDiscountedById = useMemo<Map<string, string>>(() => {
		const map = new Map<string, string>();
		if (mode.kind === "mutate") {
			for (const r of includedQuery.data?.data ?? [])
				map.set(r.id, r.discountedPrice);
		}
		return map;
	}, [mode, includedQuery.data]);

	// Rows visible after view + name search
	const visibleRows = useMemo<NormalizedProduct[]>(() => {
		const q = debouncedSearch.trim().toLowerCase();
		const matchesQ = (row: NormalizedProduct) =>
			!q || row.name.toLowerCase().includes(q);
		if (view === "all") {
			return allRows.filter(matchesQ);
		}
		// "included" view: derive from includedIds × productCache so that
		// included products show even if they don't match the current price filters
		const list: NormalizedProduct[] = [];
		for (const id of includedIds) {
			const cached = productCache.get(id);
			if (!cached) continue;
			if (matchesQ(cached)) list.push(cached);
		}
		// In mutate mode, also surface any included rows whose meta isn't in cache yet
		if (mode.kind === "mutate") {
			for (const r of includedQuery.data?.data ?? []) {
				if (productCache.has(r.id)) continue;
				const fallback: NormalizedProduct = {
					id: r.id,
					name: r.name,
					originalPrice: r.originalPrice,
					categoryNames: [],
				};
				if (matchesQ(fallback)) list.push(fallback);
			}
		}
		return list;
	}, [
		view,
		allRows,
		includedIds,
		productCache,
		debouncedSearch,
		mode,
		includedQuery.data,
	]);

	const totalAll = libraryQuery.data?.pagination?.total ?? allRows.length;
	const includedCount = includedIds.size;

	const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
		new Map(),
	);
	const flash = (id: string) => {
		setJustAdded((s) => {
			const n = new Set(s);
			n.add(id);
			return n;
		});
		const existing = flashTimers.current.get(id);
		if (existing) clearTimeout(existing);
		const t = setTimeout(() => {
			setJustAdded((s) => {
				if (!s.has(id)) return s;
				const n = new Set(s);
				n.delete(id);
				return n;
			});
			flashTimers.current.delete(id);
		}, 700);
		flashTimers.current.set(id, t);
	};

	useEffect(() => {
		const timers = flashTimers.current;
		return () => {
			for (const t of timers.values()) clearTimeout(t);
			timers.clear();
		};
	}, []);

	function toggleProduct(product: NormalizedProduct) {
		const isIncluded = includedIds.has(product.id);
		if (mode.kind === "local") {
			if (isIncluded) {
				mode.onChange(mode.includedIds.filter((id) => id !== product.id));
			} else {
				mode.onChange([...mode.includedIds, product.id]);
				flash(product.id);
			}
			return;
		}

		const key = includedQueryKey;
		if (!key) return;
		const previous = queryClient.getQueryData<typeof includedQuery.data>(key);

		if (isIncluded) {
			queryClient.setQueryData(key, (old: typeof includedQuery.data) =>
				old
					? { ...old, data: old.data.filter((r) => r.id !== product.id) }
					: old,
			);
			removeMutation.mutate([product.id], {
				onError: (e) => {
					if (previous) queryClient.setQueryData(key, previous);
					toast.error((e as Error).message);
				},
				onSuccess: (r) =>
					toast.success(
						m.promotions_toast_products_removed({ count: r.data.removed }),
					),
			});
		} else {
			const optimisticRow = {
				id: product.id,
				name: product.name,
				originalPrice: product.originalPrice,
				discountedPrice: applyPercent(product.originalPrice, mode.percent),
				brandId: null as string | null,
			};
			queryClient.setQueryData(key, (old: typeof includedQuery.data) =>
				old ? { ...old, data: [optimisticRow, ...old.data] } : old,
			);
			flash(product.id);
			addMutation.mutate([product.id], {
				onError: (e) => {
					if (previous) queryClient.setQueryData(key, previous);
					toast.error((e as Error).message);
				},
				onSuccess: (r) => {
					if (r.data.rejected.length > 0 || r.data.alreadyPresent > 0) {
						toast.message(
							m.promotions_toast_products_added({
								added: r.data.added,
								alreadyPresent: r.data.alreadyPresent,
								rejected: r.data.rejected.length,
							}),
						);
					}
				},
			});
		}
	}

	function removeAll() {
		if (mode.kind === "local") {
			mode.onChange([]);
			return;
		}
		const ids = Array.from(includedIds);
		if (ids.length === 0) return;
		const key = includedQueryKey;
		if (!key) return;
		const previous = queryClient.getQueryData<typeof includedQuery.data>(key);
		queryClient.setQueryData(key, (old: typeof includedQuery.data) =>
			old ? { ...old, data: [] } : old,
		);
		removeMutation.mutate(ids, {
			onError: (e) => {
				if (previous) queryClient.setQueryData(key, previous);
				toast.error((e as Error).message);
			},
			onSuccess: (r) =>
				toast.success(
					m.promotions_toast_products_removed({ count: r.data.removed }),
				),
		});
	}

	function clearFilters() {
		setSearch("");
		setMinPrice("");
		setMaxPrice("");
		setInStock(false);
	}

	const filtersDirty =
		search !== "" || minPrice !== "" || maxPrice !== "" || inStock;
	const libraryLoading = libraryQuery.isLoading;
	const showEmpty = !libraryLoading && visibleRows.length === 0;

	const viewTabs: TabNavItem[] = [
		{
			value: "all",
			label: m.promotions_selector_view_all(),
			count: totalAll,
		},
		{
			value: "included",
			label: m.promotions_selector_view_included(),
			count: includedCount,
			badgeColor: "blue",
		},
	];

	function emptyMessage(): string {
		if (view === "included") return m.promotions_selector_empty_included_view();
		if (filtersDirty) return m.promotions_selector_empty_library_filtered();
		return m.promotions_selector_empty_library_catalog();
	}

	return (
		<section className="space-y-4">
			<TabNav
				tabs={viewTabs}
				activeTab={view}
				onTabChange={(v) => setView(v as View)}
			>
				{includedCount > 1 && (
					<Button variant="ghost" size="sm" onClick={removeAll}>
						{m.promotions_selector_remove_all()}
					</Button>
				)}
			</TabNav>

			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-[14rem] flex-1">
					<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
					<Input
						placeholder={m.promotions_selector_search_placeholder()}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="pl-9"
					/>
				</div>
				<Input
					type="number"
					placeholder={m.promotions_selector_filter_price_min()}
					value={minPrice}
					onChange={(e) => setMinPrice(e.target.value)}
					className="w-24"
				/>
				<Input
					type="number"
					placeholder={m.promotions_selector_filter_price_max()}
					value={maxPrice}
					onChange={(e) => setMaxPrice(e.target.value)}
					className="w-24"
				/>
				<label
					htmlFor="selector-in-stock"
					className="inline-flex cursor-pointer items-center gap-2 text-sm"
				>
					<Switch
						id="selector-in-stock"
						checked={inStock}
						onCheckedChange={setInStock}
					/>
					{m.promotions_selector_filter_in_stock()}
				</label>
				{filtersDirty && (
					<Button variant="ghost" size="sm" onClick={clearFilters}>
						{m.promotions_selector_clear_filters()}
					</Button>
				)}
			</div>

			<div className="overflow-hidden rounded-lg border bg-card">
				{libraryLoading ? (
					<div className="flex h-48 items-center justify-center">
						<Spinner className="size-6" />
					</div>
				) : showEmpty ? (
					<div className="flex h-48 flex-col items-center justify-center gap-2 px-6 text-center">
						<PackageIcon className="text-muted-foreground/40 size-7" />
						<p className="text-muted-foreground max-w-sm text-sm">
							{emptyMessage()}
						</p>
						{view === "all" && filtersDirty && (
							<Button variant="link" size="sm" onClick={clearFilters}>
								{m.promotions_selector_clear_filters()}
							</Button>
						)}
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-8" />
								<TableHead>Nome</TableHead>
								<TableHead className="text-right">Prezzo</TableHead>
								<TableHead className="w-24 pr-4" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{visibleRows.map((row) => {
								const isIncluded = includedIds.has(row.id);
								const discountedPrice = isIncluded
									? (serverDiscountedById.get(row.id) ??
										applyPercent(row.originalPrice, mode.percent))
									: undefined;
								return (
									<TableRow
										key={row.id}
										tabIndex={0}
										aria-selected={isIncluded}
										onClick={() => toggleProduct(row)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												toggleProduct(row);
											}
										}}
										data-included={isIncluded}
										data-just-added={justAdded.has(row.id)}
										className={cn(
											"group cursor-pointer transition-colors duration-200",
											isIncluded
												? "bg-primary/10 hover:bg-primary/15"
												: "hover:bg-muted/40",
											"data-[just-added=true]:bg-primary/20 data-[just-added=true]:duration-500",
										)}
									>
										<TableCell className="pl-4">
											<span
												aria-hidden
												className={cn(
													"block size-2 rounded-full transition-colors",
													isIncluded
														? "bg-primary"
														: "bg-transparent ring-1 ring-inset ring-border group-hover:ring-foreground/40",
												)}
											/>
										</TableCell>
										<TableCell>
											<div className="flex flex-col gap-0.5">
												<span className="font-medium">{row.name}</span>
												<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
													{isIncluded && (
														<span className="text-primary font-medium">
															{m.promotions_selector_row_state_included()}
														</span>
													)}
													{row.categoryNames.length > 0 && (
														<span className="text-muted-foreground">
															{row.categoryNames.slice(0, 3).join(" · ")}
														</span>
													)}
												</div>
											</div>
										</TableCell>
										<TableCell className="text-right text-sm tabular-nums">
											{isIncluded && discountedPrice ? (
												<span className="inline-flex items-baseline gap-2">
													<span className="text-muted-foreground line-through">
														{formatPriceEur(row.originalPrice)}
													</span>
													<span className="text-foreground font-semibold">
														{formatPriceEur(discountedPrice)}
													</span>
												</span>
											) : (
												<span>{formatPriceEur(row.originalPrice)}</span>
											)}
										</TableCell>
										<TableCell className="pr-4 text-right">
											{isIncluded ? (
												<span className="bg-primary/15 text-primary inline-flex items-center rounded-full px-2 py-0.5 font-mono text-xs font-medium">
													−{mode.percent}%
												</span>
											) : (
												<span className="text-muted-foreground inline-block text-xs opacity-0 transition-opacity group-hover:opacity-100">
													{m.promotions_selector_row_action_add()}
												</span>
											)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</div>
		</section>
	);
}
