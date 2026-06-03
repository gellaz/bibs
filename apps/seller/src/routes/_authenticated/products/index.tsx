import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import { CopyButton } from "@bibs/ui/components/copy-button";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { DataTable, SortableHeader } from "@bibs/ui/components/data-table";
import { EmptyState } from "@bibs/ui/components/empty-state";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@bibs/ui/components/input-group";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
import {
	formatPriceEur,
	Price,
	scorporoDisplay,
} from "@bibs/ui/components/price";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { PackageIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProductBulkToolbar } from "@/features/products/components/product-bulk-toolbar";
import { ProductRowActions } from "@/features/products/components/product-row-actions";
import {
	type ProductStatusFilter,
	ProductStatusTabs,
} from "@/features/products/components/product-status-tabs";
import { ProductsFilterBar } from "@/features/products/components/products-filter-bar";
import { StockEditorCell } from "@/features/products/components/stock-editor-cell";
import { useProductSelection } from "@/features/products/hooks/use-product-selection";
import { useActiveStore } from "@/hooks/use-active-store";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

type ProductSortField =
	| "name"
	| "price"
	| "ean"
	| "stock"
	| "createdAt"
	| "updatedAt";
type SortOrder = "asc" | "desc";
const SORT_FIELDS: ProductSortField[] = [
	"name",
	"price",
	"ean",
	"stock",
	"createdAt",
	"updatedAt",
];

export const Route = createFileRoute("/_authenticated/products/")({
	component: ProductsListPage,
	validateSearch: (
		search: Record<string, unknown>,
	): {
		page: number;
		limit: number;
		statusFilter: ProductStatusFilter;
		q?: string;
		sort?: ProductSortField;
		order?: SortOrder;
		categoryIds?: string[];
		minPrice?: string;
		maxPrice?: string;
	} => {
		const sf = search.statusFilter;
		const statusFilter: ProductStatusFilter =
			sf === "disabled" || sf === "trashed" ? sf : "active";
		const rawQ = typeof search.q === "string" ? search.q : "";
		const sort = SORT_FIELDS.includes(search.sort as ProductSortField)
			? (search.sort as ProductSortField)
			: undefined;
		const order =
			search.order === "asc" || search.order === "desc"
				? (search.order as SortOrder)
				: undefined;
		// categoryIds: accetta sia repeated query (?categoryIds=a&categoryIds=b → array)
		// sia singolare (?categoryIds=a → string). Normalizziamo sempre ad array.
		const rawCats = search.categoryIds;
		const categoryIds: string[] | undefined = Array.isArray(rawCats)
			? rawCats.filter(
					(x): x is string => typeof x === "string" && x.length > 0,
				)
			: typeof rawCats === "string" && rawCats.length > 0
				? [rawCats]
				: undefined;
		const normalizedCategoryIds =
			categoryIds && categoryIds.length > 0 ? categoryIds : undefined;
		const PRICE_RE = /^\d+(\.\d{1,2})?$/;
		const minPrice =
			typeof search.minPrice === "string" && PRICE_RE.test(search.minPrice)
				? search.minPrice
				: undefined;
		const maxPrice =
			typeof search.maxPrice === "string" && PRICE_RE.test(search.maxPrice)
				? search.maxPrice
				: undefined;
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
			statusFilter,
			...(rawQ.length > 0 ? { q: rawQ } : {}),
			...(sort && order ? { sort, order } : {}),
			...(normalizedCategoryIds ? { categoryIds: normalizedCategoryIds } : {}),
			...(minPrice ? { minPrice } : {}),
			...(maxPrice ? { maxPrice } : {}),
		};
	},
});

const INITIAL_COLUMN_VISIBILITY = {
	brand: false,
	ean: false,
	vat: false,
};

const DATE_FMT_OPTS: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "short",
	day: "numeric",
};

const DATETIME_FMT_OPTS: Intl.DateTimeFormatOptions = {
	year: "numeric",
	month: "long",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
};

function DateCell({ value }: { value: string | Date }) {
	const d = value instanceof Date ? value : new Date(value);
	return (
		<time
			dateTime={d.toISOString()}
			title={d.toLocaleString("it-IT", DATETIME_FMT_OPTS)}
		>
			{d.toLocaleDateString("it-IT", DATE_FMT_OPTS)}
		</time>
	);
}

function ProductsListPage() {
	"use no memo";

	const {
		page,
		limit,
		statusFilter,
		q: routeQ,
		sort,
		order,
		categoryIds,
		minPrice,
		maxPrice,
	} = Route.useSearch();
	const navigate = useNavigate({ from: "/products/" });
	const { activeStore } = useActiveStore();

	// Input controlled, ma è il valore *deboundato* che finisce nell'URL e
	// scatena le query. Quando l'utente naviga (back/forward), il localQ viene
	// riallineato a routeQ.
	const [localQ, setLocalQ] = useState(routeQ ?? "");
	const debouncedQ = useDebouncedValue(localQ, 300);
	const effectiveRouteQ = routeQ ?? "";

	useEffect(() => {
		setLocalQ(routeQ ?? "");
	}, [routeQ]);

	useEffect(() => {
		if (debouncedQ === effectiveRouteQ) return;
		void navigate({
			search: (prev) => ({
				...prev,
				q: debouncedQ.length > 0 ? debouncedQ : undefined,
				page: 1,
			}),
		});
	}, [debouncedQ, effectiveRouteQ, navigate]);

	const { data, isLoading, error } = useQuery({
		queryKey: [
			"products",
			activeStore?.id,
			page,
			limit,
			statusFilter,
			effectiveRouteQ,
			sort,
			order,
			categoryIds,
			minPrice,
			maxPrice,
		],
		queryFn: async () => {
			const storeId = activeStore?.id;
			if (!storeId) throw new Error("No active store");
			const response = await api().seller.products.get({
				query: {
					storeId,
					page,
					limit,
					statusFilter,
					q: effectiveRouteQ.length > 0 ? effectiveRouteQ : undefined,
					...(sort && order ? { sort, order } : {}),
					...(categoryIds && categoryIds.length > 0
						? { productCategoryIds: categoryIds }
						: {}),
					...(minPrice ? { minPrice } : {}),
					...(maxPrice ? { maxPrice } : {}),
				},
			});
			if (response.error) {
				throw new Error(response.error.value?.message || "Errore caricamento");
			}
			return response.data;
		},
		enabled: !!activeStore?.id,
	});

	const sorting: SortingState =
		sort && order ? [{ id: sort, desc: order === "desc" }] : [];

	const onSortingChange = (next: SortingState) => {
		const head = next[0];
		void navigate({
			search: (prev) => ({
				...prev,
				sort: head ? (head.id as ProductSortField) : undefined,
				order: head ? (head.desc ? "desc" : "asc") : undefined,
				page: 1,
			}),
		});
	};

	type Product = NonNullable<typeof data>["data"][number];
	const rows = useMemo<Product[]>(() => data?.data ?? [], [data]);

	const currentPageIds = useMemo(() => rows.map((p) => p.id), [rows]);
	const selection = useProductSelection({
		currentPageIds,
		resetKey: `${activeStore?.id ?? ""}|${statusFilter}|${effectiveRouteQ}`,
	});

	const goToTab = (next: ProductStatusFilter) =>
		void navigate({
			search: (prev) => ({ ...prev, statusFilter: next, page: 1 }),
		});

	const emptyMessage =
		effectiveRouteQ.length > 0
			? m.products_search_no_results({ query: effectiveRouteQ })
			: statusFilter === "active"
				? m.products_empty_active()
				: statusFilter === "disabled"
					? m.products_empty_disabled()
					: m.products_empty_trashed();

	// Vista "pulita" del catalogo: tab Attivi senza ricerca né filtri. Se è
	// vuota il negozio non ha davvero prodotti: empty state ricco con CTA al
	// posto dell'intera tabella (header compreso). Con filtri attivi invece
	// l'header resta, così la struttura non salta mentre l'utente aggiusta
	// la query.
	const isPristineCatalogView =
		Boolean(activeStore) &&
		statusFilter === "active" &&
		effectiveRouteQ.length === 0 &&
		(categoryIds?.length ?? 0) === 0 &&
		!minPrice &&
		!maxPrice;

	const columns = useMemo<ColumnDef<Product>[]>(
		() => [
			{
				id: "select",
				enableHiding: false,
				meta: {
					// La rule `[&:has([role=checkbox])]:pr-0` su TableCell/TableHead
					// (Radix Checkbox imposta role=checkbox) forzerebbe pr-0 e
					// l'icona finirebbe addosso al separator. Override esplicito.
					// px-4 + 16 px checkbox = 48 px min content, in pari con la
					// colonna actions (px-2 + 32 px button = 48) per simmetria
					// visiva pinned-left ↔ pinned-right.
					headerClassName: "w-12 px-4 [&:has([role=checkbox])]:pr-4",
					cellClassName: "w-12 px-4 [&:has([role=checkbox])]:pr-4",
					sticky: "left",
				},
				header: () => (
					<div className="flex justify-center">
						<Checkbox
							checked={
								selection.headerCheckboxState === "checked"
									? true
									: selection.headerCheckboxState === "indeterminate"
										? "indeterminate"
										: false
							}
							onCheckedChange={() => selection.toggleAllOnPage()}
							aria-label="Seleziona tutti"
						/>
					</div>
				),
				cell: ({ row }) => (
					<div className="flex justify-center">
						<Checkbox
							checked={selection.isSelected(row.original.id)}
							onCheckedChange={() => selection.toggleOne(row.original.id)}
							aria-label={`Seleziona ${row.original.name}`}
						/>
					</div>
				),
			},
			{
				id: "name",
				accessorKey: "name",
				header: ({ column }) => (
					<SortableHeader column={column}>Nome</SortableHeader>
				),
				enableHiding: false,
				enableSorting: true,
				meta: {
					headerClassName: "w-[30%]",
					cellClassName: "font-semibold",
					menuLabel: "Nome",
				},
				cell: ({ row }) => {
					const product = row.original;
					const primaryImage = product.images[0]?.url;
					const isTrashed = statusFilter === "trashed";
					const thumbnail = (
						<div className="bg-warm-paper border-warm-edge size-9 shrink-0 overflow-hidden rounded-md border">
							{primaryImage ? (
								<img
									src={primaryImage}
									alt=""
									className="size-full object-cover"
									loading="lazy"
								/>
							) : (
								<div className="text-muted-foreground/50 flex size-full items-center justify-center">
									<PackageIcon className="size-4" />
								</div>
							)}
						</div>
					);
					const label = (
						<span className={isTrashed ? "text-muted-foreground" : ""}>
							{product.name}
						</span>
					);
					if (isTrashed) {
						return (
							<div className="flex items-center gap-3">
								{thumbnail}
								{label}
							</div>
						);
					}
					return (
						<Link
							to="/products/$productId"
							params={{ productId: product.id }}
							className="flex items-center gap-3 hover:underline"
						>
							{thumbnail}
							{label}
						</Link>
					);
				},
			},
			{
				id: "price",
				accessorKey: "price",
				header: ({ column }) => (
					<SortableHeader column={column}>Prezzo</SortableHeader>
				),
				enableSorting: true,
				meta: {
					headerClassName: "w-[15%]",
					cellClassName: "text-sm",
					menuLabel: "Prezzo",
				},
				cell: ({ row }) => {
					const { net } = scorporoDisplay(
						row.original.price,
						Number(row.original.vatRate),
					);
					return (
						<div className="flex flex-col leading-tight">
							<Price value={row.original.price} />
							<span className="text-muted-foreground text-xs tabular-nums">
								netto {formatPriceEur(net)}
							</span>
						</div>
					);
				},
			},
			{
				id: "vat",
				header: "IVA",
				meta: {
					headerClassName: "w-[12%]",
					cellClassName: "text-sm",
					menuLabel: "IVA",
				},
				cell: ({ row }) => {
					const rate = Number(row.original.vatRate);
					const { vat } = scorporoDisplay(row.original.price, rate);
					return (
						<div className="flex items-center gap-1.5 tabular-nums">
							<span>{formatPriceEur(vat)}</span>
							<Badge variant="secondary">{rate}%</Badge>
						</div>
					);
				},
			},
			{
				id: "stock",
				// accessorFn serve a TanStack Table per registrare il sort handler:
				// senza un accessor, getToggleSortingHandler() non aggancia il click sull'header.
				// Il valore client-side qui è solo cosmetico — l'ordering reale lo fa il backend.
				accessorFn: (row) =>
					row.storeProducts.find((sp) => sp.storeId === activeStore?.id)
						?.stock ?? 0,
				header: ({ column }) => (
					<SortableHeader column={column}>
						{m.products_stock_column_header()}
					</SortableHeader>
				),
				enableSorting: true,
				meta: {
					headerClassName: "w-[14%]",
					cellClassName: "tabular-nums",
					menuLabel: m.products_stock_column_header(),
				},
				cell: ({ row }) => {
					const sp = row.original.storeProducts.find(
						(sp) => sp.storeId === activeStore?.id,
					);
					if (!sp || !activeStore) {
						return <span className="text-muted-foreground/60">—</span>;
					}
					return (
						<StockEditorCell
							productId={row.original.id}
							storeId={activeStore.id}
							stock={sp.stock}
						/>
					);
				},
			},
			{
				id: "category",
				header: "Categoria",
				meta: {
					headerClassName: "w-[20%]",
					cellClassName: "text-sm",
				},
				cell: ({ row }) => {
					const assignments = row.original.productCategoryAssignments;
					if (assignments.length === 0) {
						return <span className="text-muted-foreground">—</span>;
					}
					const macroName = assignments[0].category.macroCategory.name;
					const cats = assignments.map((a) => a.category);
					const MAX_VISIBLE = 2;
					const visible = cats.slice(0, MAX_VISIBLE);
					const overflow = cats.length - visible.length;
					return (
						<div
							className="flex flex-col gap-1 leading-tight"
							title={cats.map((c) => c.name).join(", ")}
						>
							<span className="text-muted-foreground text-[0.65rem] font-medium tracking-[0.06em] uppercase">
								{macroName}
							</span>
							<div className="flex flex-wrap items-center gap-1">
								{visible.map((c) => (
									<Badge key={c.id}>{c.name}</Badge>
								))}
								{overflow > 0 && (
									<span className="text-muted-foreground text-xs">
										+{overflow}
									</span>
								)}
							</div>
						</div>
					);
				},
			},
			{
				id: "brand",
				header: "Marca",
				meta: {
					headerClassName: "w-[12%]",
					cellClassName: "text-muted-foreground text-sm",
				},
				cell: ({ row }) =>
					row.original.brand?.name ?? (
						<span className="text-muted-foreground/60">—</span>
					),
			},
			{
				id: "ean",
				accessorKey: "ean",
				header: ({ column }) => (
					<SortableHeader column={column}>EAN</SortableHeader>
				),
				enableSorting: true,
				meta: {
					headerClassName: "w-[12%]",
					cellClassName: "text-muted-foreground text-sm tabular-nums",
					menuLabel: "EAN",
				},
				cell: ({ row }) => {
					const ean = row.original.ean;
					if (!ean) {
						return <span className="text-muted-foreground/60">—</span>;
					}
					return (
						<div className="flex items-center gap-1">
							<span>{ean}</span>
							<CopyButton value={ean} label={`Copia EAN ${ean}`} />
						</div>
					);
				},
			},
			{
				id: "createdAt",
				accessorKey: "createdAt",
				header: ({ column }) => (
					<SortableHeader column={column}>Creato</SortableHeader>
				),
				enableSorting: true,
				meta: {
					headerClassName: "w-[12%]",
					cellClassName: "text-muted-foreground text-sm",
					menuLabel: "Creato",
				},
				cell: ({ row }) => <DateCell value={row.original.createdAt} />,
			},
			{
				id: "updatedAt",
				accessorKey: "updatedAt",
				header: ({ column }) => (
					<SortableHeader column={column}>Aggiornato</SortableHeader>
				),
				enableSorting: true,
				meta: {
					headerClassName: "w-[12%]",
					cellClassName: "text-muted-foreground text-sm",
					menuLabel: "Aggiornato",
				},
				cell: ({ row }) => <DateCell value={row.original.updatedAt} />,
			},
			{
				id: "actions",
				enableHiding: false,
				meta: {
					// Stessa larghezza della colonna select (w-12) per simmetria
					// visiva ai due bordi pinned. px-2 invece di base px-3 perche'
					// il button icon (size-8 = 32 px) richiede content area >= 32 px:
					// 48 - (8 + 8) = 32 esatti.
					headerClassName: "w-12 px-2",
					cellClassName: "w-12 px-2",
					sticky: "right",
				},
				header: ({ table }) => (
					<div className="flex justify-center">
						<TableColumnsToggle table={table} align="end" />
					</div>
				),
				cell: ({ row }) => (
					<div className="flex justify-center">
						<ProductRowActions
							productId={row.original.id}
							status={row.original.status}
							activeStoreId={activeStore?.id ?? ""}
							assignedStoreIds={row.original.storeProducts.map(
								(sp) => sp.storeId,
							)}
						/>
					</div>
				),
			},
		],
		[selection, statusFilter, activeStore?.id],
	);

	return (
		<div className="flex h-full min-w-0 flex-col gap-4">
			<div className="flex shrink-0 items-center justify-between">
				<div>
					<h1 className="font-display text-2xl font-semibold tracking-tight">
						Prodotti
					</h1>
					<p className="text-muted-foreground text-sm">
						{activeStore
							? "Catalogo, magazzino e prezzi."
							: "Seleziona un negozio per visualizzare il catalogo."}
					</p>
				</div>
				<Button asChild>
					<Link to="/products/new">
						<PlusIcon />
						<span>{m.products_new_cta()}</span>
					</Link>
				</Button>
			</div>

			{activeStore && (
				<div className="flex shrink-0 flex-col gap-3">
					<div className="flex flex-wrap items-center gap-2">
						<InputGroup className="max-w-md min-w-[240px] flex-1">
							<InputGroupAddon align="inline-start">
								<SearchIcon />
							</InputGroupAddon>
							<InputGroupInput
								value={localQ}
								onChange={(e) => setLocalQ(e.target.value)}
								placeholder={m.products_search_placeholder()}
								aria-label={m.products_search_placeholder()}
							/>
							{localQ.length > 0 && (
								<InputGroupAddon align="inline-end">
									<InputGroupButton
										size="icon-xs"
										onClick={() => setLocalQ("")}
										aria-label={m.products_search_clear()}
									>
										<XIcon />
									</InputGroupButton>
								</InputGroupAddon>
							)}
						</InputGroup>
						<ProductsFilterBar
							value={{ categoryIds, minPrice, maxPrice }}
							storeId={activeStore.id}
							statusFilter={statusFilter}
							totalResults={data?.pagination.total}
							onChange={(next) =>
								void navigate({
									search: (prev) => ({
										...prev,
										categoryIds:
											next.categoryIds && next.categoryIds.length > 0
												? next.categoryIds
												: undefined,
										minPrice: next.minPrice,
										maxPrice: next.maxPrice,
										page: 1,
									}),
								})
							}
						/>
					</div>
					<ProductStatusTabs
						storeId={activeStore.id}
						value={statusFilter}
						onChange={goToTab}
					/>
				</div>
			)}

			<div className="shrink-0">
				<ProductBulkToolbar
					selectedIds={Array.from(selection.selected)}
					activeStoreId={activeStore?.id ?? ""}
					statusFilter={statusFilter}
					onClear={selection.clear}
				/>
			</div>

			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 shrink-0 rounded-lg border p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			<DataTable
				data={rows}
				columns={columns}
				storageKey="seller.products.columns"
				initialColumnVisibility={INITIAL_COLUMN_VISIBILITY}
				getRowId={(row) => row.id}
				isLoading={isLoading}
				manualSorting={{ sorting, onSortingChange }}
				containerClassName="flex-1 min-h-0 min-w-0 overflow-auto"
				rowClassName={(row) =>
					selection.isSelected(row.original.id)
						? "bg-primary/10 hover:bg-primary/10 [&>td:not(:first-child):not(:last-child)]:opacity-60"
						: ""
				}
				hideHeaderWhenEmpty={isPristineCatalogView}
				emptyState={
					isPristineCatalogView ? (
						<EmptyState
							icon={PackageIcon}
							title={m.products_empty_catalog()}
							description={m.products_empty_catalog_description()}
							action={
								<Button asChild>
									<Link to="/products/new">
										<PlusIcon />
										<span>{m.products_new_cta()}</span>
									</Link>
								</Button>
							}
						/>
					) : (
						<EmptyState icon={PackageIcon} title={emptyMessage} />
					)
				}
			/>

			{data?.pagination &&
				data.pagination.total > 0 &&
				(() => {
					const total = data.pagination.total;
					const totalPages = Math.ceil(total / limit);
					const rangeStart = (page - 1) * limit + 1;
					const rangeEnd = Math.min(page * limit, total);
					return (
						<div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
							<p className="text-muted-foreground text-sm tabular-nums">
								{rangeStart}–{rangeEnd} di {total} prodott
								{total === 1 ? "o" : "i"}
							</p>
							<div className="flex items-center gap-4">
								<PageSizeSelector
									pageSize={limit}
									onPageSizeChange={(size) =>
										void navigate({
											search: (prev) => ({ ...prev, limit: size, page: 1 }),
										})
									}
								/>
								<DataPagination
									page={page}
									totalPages={totalPages}
									onPageChange={(next) =>
										void navigate({
											search: (prev) => ({ ...prev, page: next }),
										})
									}
								/>
							</div>
						</div>
					);
				})()}
		</div>
	);
}
