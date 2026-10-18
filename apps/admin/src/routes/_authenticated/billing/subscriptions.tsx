import { Button } from "@bibs/ui/components/button";
import { DataTable } from "@bibs/ui/custom/data-table";
import { DataTableFooter } from "@bibs/ui/custom/data-table-footer";
import { EmptyState } from "@bibs/ui/custom/empty-state";
import { formatPriceEur } from "@bibs/ui/custom/price";
import { SearchInput } from "@bibs/ui/custom/search-input";
import { StatusBadge } from "@bibs/ui/custom/status-badge";
import { TableColumnsToggle } from "@bibs/ui/custom/table-columns-toggle";
import { unwrap } from "@bibs/ui/lib/api-client";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { subscriptionStatusBadge } from "@/features/billing/subscription-status";
import { api } from "@/lib/api";
import {
	dataTableFooterLabels,
	tableColumnsToggleLabels,
} from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/billing/subscriptions")({
	component: SubscriptionsPage,
});

function formatDate(d: Date | string): string {
	return new Intl.DateTimeFormat(intlLocale(), {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(d));
}

function SubscriptionsPage() {
	"use no memo";

	const [sellerEmail, setSellerEmail] = useState("");
	const [storeName, setStoreName] = useState("");
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(20);

	const { data, isLoading, error } = useQuery({
		queryKey: ["admin", "billing", "subs", sellerEmail, storeName, page, limit],
		queryFn: async () => {
			const r = await api().admin.billing.subscriptions.get({
				query: {
					page,
					limit,
					...(sellerEmail ? { sellerEmail } : {}),
					...(storeName ? { storeName } : {}),
				},
			});
			return unwrap(r, m.billing_subs_load_error()).data;
		},
		placeholderData: keepPreviousData,
	});

	const total = data?.pagination.total ?? 0;
	const rows = data?.data ?? [];
	const isFiltered = sellerEmail.length > 0 || storeName.length > 0;

	type Row = (typeof rows)[number];

	const columns: DataTableColumnDef<Row>[] = [
		{
			id: "seller",
			header: m.billing_subs_col_seller(),
			enableHiding: false,
			cell: ({ row }) => row.original.sellerEmail,
		},
		{
			id: "store",
			header: m.billing_subs_col_store(),
			meta: {
				menuLabel: m.billing_subs_col_store(),
				cellClassName: "font-semibold",
			},
			cell: ({ row }) => row.original.storeName,
		},
		{
			id: "status",
			header: m.common_status(),
			meta: { menuLabel: m.common_status() },
			cell: ({ row }) => {
				const badge = subscriptionStatusBadge(row.original.status);
				return (
					<StatusBadge tone={badge.tone} icon={badge.icon}>
						{badge.label}
					</StatusBadge>
				);
			},
		},
		{
			id: "fee",
			header: m.billing_subs_col_fee(),
			meta: {
				menuLabel: m.billing_subs_col_fee(),
				cellClassName: "tabular-nums",
			},
			cell: ({ row }) => formatPriceEur(row.original.feeAmountCents / 100),
		},
		{
			id: "renewal",
			header: m.billing_subs_col_renewal(),
			meta: {
				menuLabel: m.billing_subs_col_renewal(),
				cellClassName: "text-muted-foreground text-sm",
			},
			cell: ({ row }) => formatDate(row.original.currentPeriodEnd),
		},
		{
			id: "created",
			header: m.billing_subs_col_created(),
			meta: {
				menuLabel: m.billing_subs_col_created(),
				cellClassName: "text-muted-foreground text-sm",
			},
			cell: ({ row }) => formatDate(row.original.createdAt),
		},
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

	const setFilter = (set: (v: string) => void) => (v: string) => {
		set(v);
		setPage(1);
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap gap-2">
				<SearchInput
					value={sellerEmail}
					onValueChange={setFilter(setSellerEmail)}
					placeholder={m.billing_subs_search_email()}
					aria-label={m.billing_subs_search_email()}
					clearLabel={m.common_clear_search()}
					className="max-w-xs"
				/>
				<SearchInput
					value={storeName}
					onValueChange={setFilter(setStoreName)}
					placeholder={m.billing_subs_search_store()}
					aria-label={m.billing_subs_search_store()}
					clearLabel={m.common_clear_search()}
					className="max-w-xs"
				/>
			</div>

			{error && (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">
						{m.common_load_error_with_message({ message: error.message })}
					</p>
				</div>
			)}

			<DataTable
				data={rows}
				columns={columns}
				storageKey="admin.billing.subscriptions.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				hideHeaderWhenEmpty={!isFiltered}
				emptyState={
					isFiltered ? (
						<EmptyState
							variant="no-results"
							title={m.common_no_results()}
							description={m.billing_subs_no_results_description()}
							action={
								<Button
									variant="outline"
									onClick={() => {
										setSellerEmail("");
										setStoreName("");
										setPage(1);
									}}
								>
									{m.common_clear_search()}
								</Button>
							}
						/>
					) : (
						<EmptyState
							title={m.billing_subs_empty_title()}
							description={m.billing_subs_empty_description()}
						/>
					)
				}
			/>

			<DataTableFooter
				page={page}
				pageSize={limit}
				total={total}
				rangeLabel={(r) =>
					(r.total === 1 ? m.billing_subs_range_one : m.billing_subs_range)(r)
				}
				labels={dataTableFooterLabels()}
				onPageSizeChange={(size) => {
					setLimit(size);
					setPage(1);
				}}
				onPageChange={setPage}
			/>
		</div>
	);
}
