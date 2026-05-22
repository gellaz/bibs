import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { Checkbox } from "@bibs/ui/components/checkbox";
import { CopyButton } from "@bibs/ui/components/copy-button";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { DataTable, SortableHeader } from "@bibs/ui/components/data-table";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@bibs/ui/components/input-group";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
import { Price } from "@bibs/ui/components/price";
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
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
			statusFilter,
			...(rawQ.length > 0 ? { q: rawQ } : {}),
			...(sort && order ? { sort, order } : {}),
		};
	},
});

const INITIAL_COLUMN_VISIBILITY = {
	brand: false,
	ean: false,
	updatedAt: false,
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

	const columns = useMemo<ColumnDef<Product>[]>(
		() => [
			{
				id: "select",
				enableHiding: false,
				meta: {
					headerClassName: "w-10 pl-4",
					cellClassName: "pl-4",
				},
				header: () => (
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
				),
				cell: ({ row }) => (
					<Checkbox
						checked={selection.isSelected(row.original.id)}
						onCheckedChange={() => selection.toggleOne(row.original.id)}
						aria-label={`Seleziona ${row.original.name}`}
					/>
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
				cell: ({ row }) => <Price value={row.original.price} />,
			},
			{
				id: "stock",
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
					headerClassName: "w-16 pr-2 text-right",
					cellClassName: "pr-4",
				},
				header: ({ table }) => <TableColumnsToggle table={table} align="end" />,
				cell: ({ row }) => (
					<ProductRowActions
						productId={row.original.id}
						status={row.original.status}
						activeStoreId={activeStore?.id ?? ""}
					/>
				),
			},
		],
		[selection, statusFilter, activeStore?.id],
	);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">
						Prodotti{activeStore ? ` — ${activeStore.name}` : ""}
					</h1>
					<p className="text-muted-foreground text-sm">
						{activeStore
							? `Catalogo del negozio ${activeStore.name}`
							: "Seleziona un negozio per visualizzare il catalogo"}
					</p>
				</div>
				<Button asChild>
					<Link to="/products/new">
						<PlusIcon />
						<span>Nuovo Prodotto</span>
					</Link>
				</Button>
			</div>

			{activeStore && (
				<div className="space-y-3">
					<InputGroup className="max-w-md">
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
					<ProductStatusTabs
						storeId={activeStore.id}
						value={statusFilter}
						onChange={goToTab}
					/>
				</div>
			)}

			<ProductBulkToolbar
				selectedIds={Array.from(selection.selected)}
				activeStoreId={activeStore?.id ?? ""}
				statusFilter={statusFilter}
				onClear={selection.clear}
			/>

			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
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
				rowClassName={(row) =>
					selection.isSelected(row.original.id)
						? "bg-primary/10 hover:bg-primary/10 [&>td]:opacity-60 [&>td:first-child]:opacity-100"
						: ""
				}
				emptyState={
					<div className="flex flex-col items-center gap-2">
						<PackageIcon className="text-muted-foreground/40 size-8" />
						<p className="text-muted-foreground font-medium">{emptyMessage}</p>
					</div>
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
						<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
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
