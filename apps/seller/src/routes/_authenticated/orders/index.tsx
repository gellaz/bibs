import { Button } from "@bibs/ui/components/button";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { DataTable } from "@bibs/ui/components/data-table";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@bibs/ui/components/dropdown-menu";
import { EmptyState } from "@bibs/ui/components/empty-state";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
import { Price } from "@bibs/ui/components/price";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@bibs/ui/components/select";
import { toast } from "@bibs/ui/components/sonner";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { cn } from "@bibs/ui/lib/utils";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MoreVerticalIcon } from "lucide-react";
import { useMemo } from "react";
import { OrderStatusBadge } from "@/features/orders/components/order-status-badge";
import {
	ORDER_TABS,
	OrderStatusTabs,
	type OrderTab,
} from "@/features/orders/components/order-status-tabs";
import {
	useMarkReady,
	useOrderCounts,
	useOrdersList,
} from "@/features/orders/hooks/use-orders";
import {
	canMarkReady,
	ORDER_TYPE_LABEL,
	type OrderType,
	reservationTimeLeft,
	shortOrderId,
} from "@/features/orders/order-labels";
import { useActiveStore } from "@/hooks/use-active-store";
import { m } from "@/paraglide/messages";

const ORDER_TYPES: readonly OrderType[] = [
	"reserve_pickup",
	"pay_pickup",
	"pay_deliver",
	"direct",
];
const ALL_TYPES = "all";

export const Route = createFileRoute("/_authenticated/orders/")({
	component: OrdersListPage,
	validateSearch: (search: Record<string, unknown>) => {
		const tab: OrderTab = ORDER_TABS.includes(search.tab as OrderTab)
			? (search.tab as OrderTab)
			: "all";
		const type = ORDER_TYPES.includes(search.type as OrderType)
			? (search.type as OrderType)
			: undefined;
		return {
			tab,
			type,
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
		};
	},
});

const DATE_FMT: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "short",
	hour: "2-digit",
	minute: "2-digit",
};

function OrdersListPage() {
	const { tab, type, page, limit } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { activeStore, isLoading: storeLoading } = useActiveStore();
	const storeId = activeStore?.id;

	const { data, isLoading, error } = useOrdersList({
		storeId,
		page,
		limit,
		status: tab === "all" ? undefined : tab,
		type,
	});
	const { data: counts } = useOrderCounts({ storeId, type });
	const markReady = useMarkReady();

	type Row = NonNullable<typeof data>["data"][number];
	const rows = data?.data ?? [];

	const columns = useMemo<DataTableColumnDef<Row>[]>(
		() => [
			{
				id: "order",
				header: () => m.orders_col_order(),
				enableHiding: false,
				meta: { menuLabel: m.orders_col_order(), headerClassName: "w-28" },
				cell: ({ row }) => (
					<Link
						to="/orders/$orderId"
						params={{ orderId: row.original.id }}
						className="font-medium tabular-nums hover:underline"
					>
						{shortOrderId(row.original.id)}
					</Link>
				),
			},
			{
				id: "status",
				header: () => m.orders_col_status(),
				enableHiding: false,
				meta: { menuLabel: m.orders_col_status(), headerClassName: "w-40" },
				cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
			},
			{
				id: "date",
				header: () => m.orders_col_date(),
				meta: {
					menuLabel: m.orders_col_date(),
					cellClassName: "text-sm tabular-nums whitespace-nowrap",
				},
				cell: ({ row }) =>
					new Date(row.original.createdAt).toLocaleString("it-IT", DATE_FMT),
			},
			{
				id: "customer",
				header: () => m.orders_col_customer(),
				meta: { menuLabel: m.orders_col_customer() },
				cell: ({ row }) => row.original.customerProfile.user.name,
			},
			{
				id: "type",
				header: () => m.orders_col_type(),
				meta: {
					menuLabel: m.orders_col_type(),
					cellClassName: "text-sm",
				},
				cell: ({ row }) => ORDER_TYPE_LABEL[row.original.type](),
			},
			{
				id: "items",
				header: () => m.orders_col_items(),
				meta: {
					menuLabel: m.orders_col_items(),
					headerClassName: "w-20 text-right",
					cellClassName: "text-right tabular-nums",
				},
				cell: ({ row }) =>
					row.original.items.reduce((s, i) => s + i.quantity, 0),
			},
			{
				id: "total",
				header: () => m.orders_col_total(),
				meta: {
					menuLabel: m.orders_col_total(),
					headerClassName: "w-28 text-right",
					cellClassName: "text-right",
				},
				cell: ({ row }) => <Price value={row.original.total} />,
			},
			{
				id: "deadline",
				header: () => m.orders_col_deadline(),
				meta: {
					menuLabel: m.orders_col_deadline(),
					cellClassName: "text-sm tabular-nums whitespace-nowrap",
				},
				cell: ({ row }) => {
					const r = row.original;
					const open =
						r.status === "confirmed" || r.status === "ready_for_pickup";
					if (r.type !== "reserve_pickup" || !r.reservationExpiresAt || !open)
						return <span className="text-muted-foreground">—</span>;
					const left = reservationTimeLeft(r.reservationExpiresAt);
					return (
						<span className={cn(left.expired && "text-destructive")}>
							{left.label}
						</span>
					);
				},
			},
			{
				id: "actions",
				enableHiding: false,
				meta: {
					headerClassName: "w-12 pr-2 text-right",
					cellClassName: "text-right",
				},
				header: ({ table }) => <TableColumnsToggle table={table} align="end" />,
				cell: ({ row }) => {
					const r = row.original;
					return (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon-sm">
									<MoreVerticalIcon />
									<span className="sr-only">Azioni</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem asChild>
									<Link to="/orders/$orderId" params={{ orderId: r.id }}>
										{m.orders_action_detail()}
									</Link>
								</DropdownMenuItem>
								{canMarkReady(r) && (
									<DropdownMenuItem
										onSelect={() =>
											markReady.mutate(r.id, {
												onSuccess: () =>
													toast.success(m.orders_ready_success()),
												onError: (e) => toast.error(e.message),
											})
										}
									>
										{m.orders_action_ready()}
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					);
				},
			},
		],
		[markReady],
	);

	const goToTab = (next: OrderTab) =>
		void navigate({ search: (prev) => ({ ...prev, tab: next, page: 1 }) });

	if (!activeStore && !storeLoading)
		return <EmptyState title={m.orders_empty_all()} />;

	const isPristine = tab === "all" && !type;

	return (
		<div className="flex h-full min-w-0 flex-col gap-4">
			<div className="shrink-0">
				<h1 className="font-display font-semibold text-2xl tracking-tight">
					{m.orders_page_title()}
				</h1>
				<p className="text-muted-foreground text-sm">
					{m.orders_page_subtitle()}
				</p>
			</div>

			<div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
				<OrderStatusTabs value={tab} onChange={goToTab} counts={counts} />
				<Select
					value={type ?? ALL_TYPES}
					onValueChange={(v) =>
						void navigate({
							search: (prev) => ({
								...prev,
								type: v === ALL_TYPES ? undefined : (v as OrderType),
								page: 1,
							}),
						})
					}
				>
					<SelectTrigger className="w-56" aria-label={m.orders_col_type()}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_TYPES}>{m.orders_type_all()}</SelectItem>
						{ORDER_TYPES.map((t) => (
							<SelectItem key={t} value={t}>
								{ORDER_TYPE_LABEL[t]()}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{error && (
				<div className="shrink-0 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-destructive">
					<p className="text-sm">{(error as Error).message}</p>
				</div>
			)}

			<DataTable
				data={rows}
				columns={columns}
				storageKey="seller.orders.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading || storeLoading}
				containerClassName="flex-1 min-h-0 min-w-0 overflow-auto"
				hideHeaderWhenEmpty
				emptyState={
					isPristine ? (
						<EmptyState
							title={m.orders_empty_all()}
							description={m.orders_empty_all_description()}
						/>
					) : (
						<EmptyState title={m.orders_empty_tab()} />
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
								{rangeStart}–{rangeEnd} di {total}
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
