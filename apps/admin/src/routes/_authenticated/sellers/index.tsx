import { Button } from "@bibs/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@bibs/ui/components/input-group";
import { DataPagination } from "@bibs/ui/custom/data-pagination";
import { DataTable, SortableHeader } from "@bibs/ui/custom/data-table";
import { EmptyState } from "@bibs/ui/custom/empty-state";
import { PageSizeSelector } from "@bibs/ui/custom/page-size-selector";
import { TabNav, type TabNavItem } from "@bibs/ui/custom/tab-nav";
import { TableColumnsToggle } from "@bibs/ui/custom/table-columns-toggle";
import { useDebouncedValue } from "@bibs/ui/hooks/use-debounced-value";
import { formatDate } from "@bibs/ui/lib/date";
import { displayName } from "@bibs/ui/lib/display-name";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { SortingState } from "@tanstack/react-table";
import { CheckCircle2Icon, SearchIcon, XCircleIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OnboardingStatusBadge } from "@/components/onboarding-status-badge";
import { PageHeader } from "@/components/page-header";
import {
	SellerModerationDialog,
	useSellerModeration,
} from "@/components/seller-moderation-dialog";
import { api } from "@/lib/api";
import {
	dataPaginationLabels,
	tableColumnsToggleLabels,
} from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

type SellerStatus = "pending_review" | "active" | "rejected";
type SortByField = "name" | "createdAt";
type SortOrder = "asc" | "desc";

const STATUS_TABS = [
	{ value: "all", label: m.sellers_tab_all, badgeColor: "default" },
	{
		value: "pending_review",
		label: m.sellers_tab_pending_review,
		badgeColor: "warning",
	},
	{ value: "active", label: m.sellers_tab_active, badgeColor: "success" },
	{
		value: "rejected",
		label: m.sellers_tab_rejected,
		badgeColor: "destructive",
	},
] as const;

const EMPTY_DESCRIPTION: Record<string, () => string> = {
	pending_review: m.sellers_empty_pending_review,
	rejected: m.sellers_empty_rejected,
	active: m.sellers_empty_active,
};

export const Route = createFileRoute("/_authenticated/sellers/")({
	component: SellersPage,
	validateSearch: (search: Record<string, unknown>) => ({
		status: (search.status as string) || undefined,
	}),
});

interface Seller {
	id: string;
	userId: string;
	onboardingStatus: string;
	firstName: string | null;
	lastName: string | null;
	createdAt: string | Date;
	user: {
		id: string;
		name: string;
		email: string;
	};
	organization: {
		id: string;
		businessName: string;
		vatNumber: string;
		vatStatus: string;
	} | null;
}

function SellersPage() {
	"use no memo";

	const { status } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const moderation = useSellerModeration();

	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(20);
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 300);
	const [sortBy, setSortBy] = useState<SortByField>("createdAt");
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

	const activeTab = status ?? "all";

	// Cambiando tab azzeriamo ricerca e pagina.
	useEffect(() => {
		setPage(1);
		setSearch("");
	}, [status]);

	// La ricerca deboundata riporta sempre alla prima pagina.
	useEffect(() => {
		setPage(1);
	}, [debouncedSearch]);

	const sorting: SortingState = [{ id: sortBy, desc: sortOrder === "desc" }];

	const onSortingChange = (next: SortingState) => {
		const head = next[0];
		if (head) {
			setSortBy(head.id as SortByField);
			setSortOrder(head.desc ? "desc" : "asc");
		} else {
			// SortableHeader rimuove l'ordinamento al terzo clic: torniamo al
			// default (più recenti) invece di lasciare la query senza ordine.
			setSortBy("createdAt");
			setSortOrder("desc");
		}
		setPage(1);
	};

	const { data: countsData } = useQuery({
		queryKey: ["admin-sellers-counts"],
		queryFn: async () => {
			const response = await api().admin.sellers.counts.get();
			if (response.error) return null;
			return response.data?.data ?? null;
		},
	});

	const { data, isLoading, error } = useQuery({
		queryKey: [
			"admin-sellers",
			status,
			page,
			limit,
			debouncedSearch,
			sortBy,
			sortOrder,
		],
		queryFn: async () => {
			const response = await api().admin.sellers.get({
				query: {
					page,
					limit,
					...(status ? { status: status as SellerStatus } : {}),
					...(debouncedSearch ? { search: debouncedSearch } : {}),
					sortBy,
					sortOrder,
				},
			});

			if (response.error) {
				throw new Error(
					response.error.value?.message || m.sellers_load_error(),
				);
			}

			return response.data;
		},
	});

	const handleTabChange = (value: string) => {
		void navigate({
			search: {
				status: value === "all" ? undefined : value,
			},
		});
	};

	const showActions = !status || status === "pending_review";

	const sellerTabs: TabNavItem[] = STATUS_TABS.map((tab) => ({
		value: tab.value,
		label: tab.label(),
		badgeColor: tab.badgeColor,
		count:
			tab.value === "all"
				? countsData
					? (countsData.pending_review ?? 0) +
						(countsData.active ?? 0) +
						(countsData.rejected ?? 0)
					: null
				: countsData
					? (countsData[
							tab.value as "pending_review" | "active" | "rejected"
						] ?? 0)
					: null,
	}));

	const rows = useMemo<Seller[]>(() => (data?.data as Seller[]) ?? [], [data]);

	const columns = useMemo<DataTableColumnDef<Seller>[]>(() => {
		const cols: DataTableColumnDef<Seller>[] = [
			{
				id: "name",
				accessorFn: (row) =>
					row.firstName && row.lastName
						? `${row.firstName} ${row.lastName}`
						: displayName(row.user),
				enableHiding: false,
				enableSorting: true,
				meta: {
					menuLabel: m.sellers_column_seller(),
					headerClassName: "pl-4",
					cellClassName: "pl-6 font-semibold",
				},
				header: ({ column }) => (
					<SortableHeader column={column}>
						{m.sellers_column_seller()}
					</SortableHeader>
				),
				cell: ({ row }) => {
					const s = row.original;
					return (
						<Link
							to="/sellers/$sellerId"
							params={{ sellerId: s.id }}
							className="hover:text-primary hover:underline"
						>
							{s.firstName && s.lastName
								? `${s.firstName} ${s.lastName}`
								: displayName(s.user)}
						</Link>
					);
				},
			},
			{
				id: "email",
				header: m.common_email(),
				meta: { cellClassName: "text-muted-foreground text-sm" },
				cell: ({ row }) => row.original.user.email,
			},
			{
				id: "organization",
				header: m.sellers_company(),
				meta: { cellClassName: "text-sm" },
				cell: ({ row }) =>
					row.original.organization?.businessName ?? (
						<span className="text-muted-foreground">—</span>
					),
			},
			{
				id: "vatNumber",
				header: m.sellers_column_vat(),
				meta: { cellClassName: "text-sm" },
				cell: ({ row }) =>
					row.original.organization ? (
						<code className="text-xs">
							{row.original.organization.vatNumber}
						</code>
					) : (
						<span className="text-muted-foreground">—</span>
					),
			},
		];

		if (!status) {
			cols.push({
				id: "onboardingStatus",
				header: m.common_status(),
				cell: ({ row }) => (
					<OnboardingStatusBadge status={row.original.onboardingStatus} />
				),
			});
		}

		cols.push({
			id: "createdAt",
			accessorKey: "createdAt",
			enableSorting: true,
			meta: {
				menuLabel: m.common_registered_at(),
				cellClassName: "text-muted-foreground text-sm",
			},
			header: ({ column }) => (
				<SortableHeader column={column}>
					{m.common_registered_at()}
				</SortableHeader>
			),
			cell: ({ row }) => formatDate(row.original.createdAt, { long: true }),
		});

		if (showActions) {
			cols.push({
				id: "actions",
				enableHiding: false,
				meta: {
					headerClassName: "pr-6 text-right",
					cellClassName: "pr-6 text-right",
				},
				header: ({ table }) => (
					<TableColumnsToggle
						table={table}
						labels={tableColumnsToggleLabels()}
						align="end"
					/>
				),
				cell: ({ row }) => {
					const s = row.original;
					if (s.onboardingStatus !== "pending_review") return null;
					return (
						<div className="flex items-center justify-end gap-1.5">
							<Button
								variant="success"
								size="sm"
								onClick={() =>
									moderation.setTarget({
										type: "verify",
										sellerId: s.id,
										sellerName:
											s.organization?.businessName ?? displayName(s.user),
									})
								}
							>
								<CheckCircle2Icon className="size-3.5" />
								{m.sellers_approve()}
							</Button>
							<Button
								variant="destructive"
								size="sm"
								onClick={() =>
									moderation.setTarget({
										type: "reject",
										sellerId: s.id,
										sellerName:
											s.organization?.businessName ?? displayName(s.user),
									})
								}
							>
								<XCircleIcon className="size-3.5" />
								{m.sellers_reject()}
							</Button>
						</div>
					);
				},
			});
		} else {
			// When actions are hidden, still need a column to host the toggle.
			cols.push({
				id: "toggle",
				enableHiding: false,
				meta: { headerClassName: "w-12 pr-6 text-right" },
				header: ({ table }) => (
					<TableColumnsToggle
						table={table}
						labels={tableColumnsToggleLabels()}
						align="end"
					/>
				),
				cell: () => null,
			});
		}

		return cols;
	}, [status, showActions]);

	return (
		<div className="space-y-4">
			<PageHeader
				title={m.common_sellers()}
				description={m.sellers_description()}
			/>

			<TabNav
				tabs={sellerTabs}
				activeTab={activeTab}
				onTabChange={handleTabChange}
				label={m.sellers_tabs_label()}
			/>

			<InputGroup className="max-w-md">
				<InputGroupAddon align="inline-start">
					<SearchIcon />
				</InputGroupAddon>
				<InputGroupInput
					placeholder={m.sellers_search_placeholder()}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					aria-label={m.sellers_search_label()}
				/>
				{search.length > 0 && (
					<InputGroupAddon align="inline-end">
						<InputGroupButton
							size="icon-xs"
							onClick={() => setSearch("")}
							aria-label={m.common_clear_search()}
						>
							<XIcon />
						</InputGroupButton>
					</InputGroupAddon>
				)}
			</InputGroup>

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
				storageKey="admin.sellers.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				manualSorting={{ sorting, onSortingChange }}
				hideHeaderWhenEmpty={!debouncedSearch}
				emptyState={
					debouncedSearch ? (
						<EmptyState
							variant="no-results"
							title={m.common_no_results()}
							description={m.sellers_no_results_description({
								query: debouncedSearch,
							})}
						/>
					) : (
						<EmptyState
							variant="empty"
							title={m.sellers_empty_title()}
							description={(
								EMPTY_DESCRIPTION[status ?? ""] ?? m.sellers_empty_all
							)()}
						/>
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
						<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
							<p className="text-muted-foreground text-sm tabular-nums">
								{(total === 1
									? m.sellers_pagination_range_one
									: m.sellers_pagination_range)({
									start: rangeStart,
									end: rangeEnd,
									total,
								})}
							</p>
							<div className="flex items-center gap-4">
								<PageSizeSelector
									label={m.common_rows_per_page()}
									pageSize={limit}
									onPageSizeChange={(size) => {
										setLimit(size);
										setPage(1);
									}}
								/>
								<DataPagination
									labels={dataPaginationLabels()}
									page={page}
									totalPages={totalPages}
									onPageChange={setPage}
								/>
							</div>
						</div>
					);
				})()}

			<SellerModerationDialog
				target={moderation.target}
				onOpenChange={(open) => {
					if (!open) moderation.setTarget(null);
				}}
				onConfirm={moderation.confirm}
				isPending={moderation.isPending}
			/>
		</div>
	);
}
