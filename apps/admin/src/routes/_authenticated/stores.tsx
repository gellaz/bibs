import { Badge } from "@bibs/ui/components/badge";
import { DataTable, SortableHeader } from "@bibs/ui/custom/data-table";
import { DataTableFooter } from "@bibs/ui/custom/data-table-footer";
import { EmptyState } from "@bibs/ui/custom/empty-state";
import { PageHeader } from "@bibs/ui/custom/page-header";
import { SearchInput } from "@bibs/ui/custom/search-input";
import { TabNav, type TabNavItem } from "@bibs/ui/custom/tab-nav";
import { TableColumnsToggle } from "@bibs/ui/custom/table-columns-toggle";
import { formatDate } from "@bibs/ui/lib/date";
import { parsePaginationSearch } from "@bibs/ui/lib/pagination-search";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { subscriptionStatusBadge } from "@/features/billing/subscription-status";
import { api } from "@/lib/api";
import {
	dataTableFooterLabels,
	tableColumnsToggleLabels,
} from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

const STATUSES = [
	"all",
	"active",
	"past_due",
	"suspended",
	"none",
	"deleted",
] as const;
type StoreStatus = (typeof STATUSES)[number];
type SortField = "name" | "createdAt";
type SortDir = "asc" | "desc";

const TABS: {
	value: StoreStatus;
	label: () => string;
	badgeColor: TabNavItem["badgeColor"];
}[] = [
	{ value: "all", label: m.stores_tab_all, badgeColor: "default" },
	{ value: "active", label: m.stores_tab_active, badgeColor: "success" },
	{
		value: "past_due",
		label: m.stores_tab_past_due,
		badgeColor: "destructive",
	},
	{
		value: "suspended",
		label: m.stores_tab_suspended,
		badgeColor: "destructive",
	},
	{ value: "none", label: m.stores_tab_none, badgeColor: "default" },
	{ value: "deleted", label: m.stores_tab_deleted, badgeColor: "default" },
];

export const Route = createFileRoute("/_authenticated/stores")({
	component: StoresPage,
	validateSearch: (
		search: Record<string, unknown>,
	): {
		page: number;
		limit: number;
		status?: StoreStatus;
		q?: string;
		sort?: SortField;
		order?: SortDir;
	} => {
		const status = STATUSES.includes(search.status as StoreStatus)
			? (search.status as StoreStatus)
			: undefined;
		const q =
			typeof search.q === "string" && search.q.length > 0
				? search.q
				: undefined;
		const sort =
			search.sort === "name" || search.sort === "createdAt"
				? (search.sort as SortField)
				: undefined;
		const order =
			search.order === "asc" || search.order === "desc"
				? (search.order as SortDir)
				: undefined;
		return {
			...parsePaginationSearch(search),
			...(status && status !== "all" ? { status } : {}),
			...(q ? { q } : {}),
			...(sort && order ? { sort, order } : {}),
		};
	},
});

function StoresPage() {
	"use no memo";

	const {
		page,
		limit,
		status = "all",
		q = "",
		sort,
		order,
	} = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	const { data: counts } = useQuery({
		queryKey: ["admin-stores-counts"],
		queryFn: async () => {
			const res = await api().admin.stores.counts.get();
			return res.error ? null : (res.data?.data ?? null);
		},
	});

	const { data, isLoading, error } = useQuery({
		queryKey: ["admin-stores", status, page, limit, q, sort, order],
		queryFn: async () => {
			const res = await api().admin.stores.get({
				query: {
					page,
					limit,
					status,
					...(q ? { search: q } : {}),
					sortBy: sort ?? "createdAt",
					sortOrder: order ?? "desc",
				},
			});
			if (res.error)
				throw new Error(res.error.value?.message || m.stores_load_error());
			return res.data;
		},
	});

	type Row = NonNullable<typeof data>["data"][number];
	const rows = data?.data ?? [];

	const sorting: SortingState = sort
		? [{ id: sort, desc: order === "desc" }]
		: [];
	const onSortingChange = (next: SortingState) => {
		const head = next[0];
		void navigate({
			search: (prev) => ({
				...prev,
				sort: head ? (head.id as SortField) : undefined,
				order: head ? (head.desc ? "desc" : "asc") : undefined,
				page: 1,
			}),
		});
	};

	const tabs: TabNavItem[] = TABS.map((tab) => ({
		value: tab.value,
		label: tab.label(),
		badgeColor: tab.badgeColor,
		count: counts ? counts[tab.value] : null,
	}));

	const sellerLink = (row: Row, children: ReactNode) => (
		<Link
			to="/sellers/$sellerId"
			params={{ sellerId: row.sellerProfileId }}
			className="hover:text-primary hover:underline"
		>
			{children}
		</Link>
	);
	const dash = <span className="text-muted-foreground">—</span>;

	const columns: DataTableColumnDef<Row>[] = [
		{
			id: "name",
			accessorKey: "name",
			enableHiding: false,
			enableSorting: true,
			meta: {
				menuLabel: m.stores_column_store(),
				cellClassName: "font-semibold",
			},
			header: ({ column }) => (
				<SortableHeader column={column}>
					{m.stores_column_store()}
				</SortableHeader>
			),
			cell: ({ row }) => sellerLink(row.original, row.original.name),
		},
		{
			id: "seller",
			header: m.stores_column_seller(),
			meta: { menuLabel: m.stores_column_seller(), cellClassName: "text-sm" },
			cell: ({ row }) =>
				row.original.businessName
					? sellerLink(row.original, row.original.businessName)
					: dash,
		},
		{
			id: "category",
			header: m.stores_column_category(),
			meta: {
				menuLabel: m.stores_column_category(),
				cellClassName: "text-sm",
			},
			cell: ({ row }) => row.original.categoryName ?? dash,
		},
		{
			id: "municipality",
			header: m.stores_column_municipality(),
			meta: {
				menuLabel: m.stores_column_municipality(),
				cellClassName: "text-sm",
			},
			cell: ({ row }) =>
				`${row.original.municipality.name} (${row.original.municipality.provinceAcronym})`,
		},
		{
			id: "subscription",
			header: m.stores_column_subscription(),
			meta: { menuLabel: m.stores_column_subscription() },
			cell: ({ row }) => {
				if (!row.original.subscriptionStatus) return dash;
				const badge = subscriptionStatusBadge(row.original.subscriptionStatus);
				return <Badge variant={badge.variant}>{badge.label}</Badge>;
			},
		},
		{
			id: "createdAt",
			accessorKey: "createdAt",
			enableSorting: true,
			meta: {
				menuLabel: m.stores_column_created_at(),
				cellClassName: "text-muted-foreground text-sm",
			},
			header: ({ column }) => (
				<SortableHeader column={column}>
					{m.stores_column_created_at()}
				</SortableHeader>
			),
			cell: ({ row }) => formatDate(row.original.createdAt, { long: true }),
		},
		...(status === "deleted"
			? [
					{
						id: "deletedAt",
						header: m.stores_column_deleted_at(),
						meta: {
							menuLabel: m.stores_column_deleted_at(),
							cellClassName: "text-muted-foreground text-sm",
						},
						cell: ({ row }) =>
							row.original.deletedAt
								? formatDate(row.original.deletedAt, { long: true })
								: dash,
					} satisfies DataTableColumnDef<Row>,
				]
			: []),
		{
			id: "toggle",
			enableHiding: false,
			meta: { headerClassName: "w-12 text-right" },
			header: ({ table }) => (
				<TableColumnsToggle
					table={table}
					labels={tableColumnsToggleLabels()}
					align="end"
				/>
			),
			cell: () => null,
		},
	];

	return (
		<div className="space-y-4">
			<PageHeader
				title={m.common_stores()}
				description={m.stores_description()}
			/>

			<TabNav
				tabs={tabs}
				activeTab={status}
				onTabChange={(value) =>
					void navigate({
						search: (prev) => ({
							...prev,
							status: value === "all" ? undefined : (value as StoreStatus),
							page: 1,
						}),
					})
				}
				label={m.stores_tabs_label()}
			/>

			<SearchInput
				value={q}
				onValueChange={(next) =>
					void navigate({
						search: (prev) => ({
							...prev,
							q: next.length > 0 ? next : undefined,
							page: 1,
						}),
					})
				}
				placeholder={m.stores_search_placeholder()}
				aria-label={m.stores_search_label()}
				clearLabel={m.common_clear_search()}
				className="max-w-md"
			/>

			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">
						{m.common_load_error_with_message({
							message: (error as Error).message,
						})}
					</p>
				</div>
			)}

			<DataTable
				data={rows}
				columns={columns}
				storageKey="admin.stores.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				manualSorting={{ sorting, onSortingChange }}
				hideHeaderWhenEmpty={q.length === 0}
				emptyState={
					q.length > 0 ? (
						<EmptyState
							variant="no-results"
							title={m.common_no_results()}
							description={m.stores_no_results_description({ query: q })}
						/>
					) : (
						<EmptyState
							title={m.stores_empty_title()}
							description={
								status === "all"
									? m.stores_empty_description()
									: m.stores_empty_tab_description()
							}
						/>
					)
				}
			/>

			<DataTableFooter
				page={page}
				pageSize={limit}
				total={data?.pagination.total ?? 0}
				rangeLabel={(r) =>
					(r.total === 1
						? m.stores_pagination_range_one
						: m.stores_pagination_range)(r)
				}
				labels={dataTableFooterLabels()}
				onPageSizeChange={(size) =>
					void navigate({
						search: (prev) => ({ ...prev, limit: size, page: 1 }),
					})
				}
				onPageChange={(next, options) =>
					void navigate({
						search: (prev) => ({ ...prev, page: next }),
						replace: options?.replace,
					})
				}
			/>
		</div>
	);
}
