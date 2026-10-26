import { DataTable } from "@bibs/ui/custom/data-table";
import { DataTableFooter } from "@bibs/ui/custom/data-table-footer";
import { EmptyState } from "@bibs/ui/custom/empty-state";
import { PageHeader } from "@bibs/ui/custom/page-header";
import { TabNav, type TabNavItem } from "@bibs/ui/custom/tab-nav";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { displayName } from "@bibs/ui/lib/display-name";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import type { DataTableColumnDef } from "@bibs/ui/lib/table-features";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { requestCountsQuery } from "@/features/requests/use-request-counts";
import { adminApi } from "@/lib/api";
import { dataTableFooterLabels } from "@/lib/ui-labels";
import { m } from "@/paraglide/messages";

type RequestType = "all" | "candidature" | "vat" | "document";

const TABS = [
	{ value: "all", label: m.requests_tab_all },
	{ value: "candidature", label: m.requests_tab_candidature },
	{ value: "vat", label: m.requests_tab_vat },
	{ value: "document", label: m.requests_tab_document },
] as const;

const KIND_LABEL = {
	candidature: m.requests_kind_candidature,
	vat: m.requests_kind_vat,
	document: m.requests_kind_document,
};

const EMPTY_DESCRIPTION: Record<RequestType, () => string> = {
	all: m.requests_empty_all,
	candidature: m.requests_empty_candidature,
	vat: m.requests_empty_vat,
	document: m.requests_empty_document,
};

export const Route = createFileRoute("/_authenticated/requests/")({
	component: RequestsPage,
	validateSearch: (search: Record<string, unknown>) => ({
		type: TABS.some((t) => t.value === search.type)
			? (search.type as RequestType)
			: undefined,
	}),
});

interface RequestRow {
	kind: "candidature" | "vat" | "document";
	id: string;
	sellerProfileId: string;
	seller: { name: string | null; email: string };
	businessName: string | null;
	currentValue: string | null;
	requestedValue: string | null;
	submittedAt: string | Date;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	["day", 86_400_000],
	["hour", 3_600_000],
	["minute", 60_000],
];

/** «3 giorni fa»: la data di invio, più leggibile per chi ordina per attesa. */
function timeAgo(value: string | Date): string {
	const diff = new Date(value).getTime() - Date.now();
	const [unit, ms] = UNITS.find(([, size]) => Math.abs(diff) >= size) ?? [
		"minute",
		60_000,
	];
	return new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto" }).format(
		Math.round(diff / ms),
		unit,
	);
}

function RequestsPage() {
	"use no memo";

	const { type: typeParam } = Route.useSearch();
	const type = typeParam ?? "all";
	const navigate = useNavigate({ from: Route.fullPath });
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(20);

	// Cambiando scheda si riparte dalla prima pagina.
	useEffect(() => setPage(1), [type]);

	const { data: counts } = useQuery(requestCountsQuery);

	const { data, isLoading, error } = useQuery({
		queryKey: ["admin-requests", type, page, limit],
		queryFn: async () =>
			unwrapJson(
				await adminApi.requests.$get({ query: { type, page, limit } }),
				m.requests_load_error(),
			),
	});

	const tabs: TabNavItem[] = TABS.map((tab) => ({
		value: tab.value,
		label: tab.label(),
		badgeColor: tab.value === "all" ? "default" : "action",
		count: counts
			? tab.value === "all"
				? counts.total
				: counts[tab.value]
			: null,
	}));

	const rows = useMemo<RequestRow[]>(() => data?.data ?? [], [data]);

	const columns = useMemo<DataTableColumnDef<RequestRow>[]>(
		() => [
			{
				id: "seller",
				header: m.requests_column_seller(),
				enableHiding: false,
				cell: ({ row }) => {
					const r = row.original;
					const name = displayName(r.seller);
					const className = "font-semibold hover:text-primary hover:underline";
					return (
						<div>
							{r.kind === "candidature" ? (
								<Link
									to="/sellers/$sellerId"
									params={{ sellerId: r.sellerProfileId }}
									className={className}
								>
									{name}
								</Link>
							) : (
								<Link
									to="/requests/$changeId"
									params={{ changeId: r.id }}
									className={className}
								>
									{name}
								</Link>
							)}
							{r.businessName && (
								<div className="text-muted-foreground text-xs">
									{r.businessName}
								</div>
							)}
						</div>
					);
				},
			},
			{
				id: "kind",
				header: m.requests_column_type(),
				meta: { cellClassName: "text-sm" },
				cell: ({ row }) => KIND_LABEL[row.original.kind](),
			},
			{
				id: "change",
				header: m.requests_column_change(),
				meta: { cellClassName: "text-sm" },
				cell: ({ row }) => {
					const r = row.original;
					if (r.kind === "candidature") return m.requests_new_seller();
					return `${r.currentValue ?? "—"} → ${r.requestedValue ?? "—"}`;
				},
			},
			{
				id: "waiting",
				header: m.requests_column_waiting(),
				meta: { cellClassName: "text-muted-foreground text-sm" },
				cell: ({ row }) => timeAgo(row.original.submittedAt),
			},
		],
		[],
	);

	return (
		<div className="space-y-4">
			<PageHeader
				title={m.requests_title()}
				description={m.requests_description()}
			/>

			<TabNav
				tabs={tabs}
				activeTab={type}
				onTabChange={(value) =>
					void navigate({
						search: {
							type: value === "all" ? undefined : (value as RequestType),
						},
					})
				}
				label={m.requests_tabs_label()}
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
				getRowId={(row) => `${row.kind}-${row.id}`}
				isLoading={isLoading}
				hideHeaderWhenEmpty
				emptyState={
					<EmptyState
						variant="empty"
						title={m.requests_empty_title()}
						description={EMPTY_DESCRIPTION[type]()}
					/>
				}
			/>

			<DataTableFooter
				page={page}
				pageSize={limit}
				total={data?.pagination.total ?? 0}
				rangeLabel={(r) =>
					(r.total === 1
						? m.requests_pagination_range_one
						: m.requests_pagination_range)(r)
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
