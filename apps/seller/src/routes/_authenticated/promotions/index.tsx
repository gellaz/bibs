import { Badge } from "@bibs/ui/components/badge";
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
import { toast } from "@bibs/ui/components/sonner";
import { TableColumnsToggle } from "@bibs/ui/components/table-columns-toggle";
import { CreateIcon } from "@bibs/ui/icons";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreVerticalIcon } from "lucide-react";
import { useMemo } from "react";
import { PromotionStateBadge } from "@/features/promotions/components/promotion-state-badge";
import {
	type PromotionState,
	PromotionStateTabs,
} from "@/features/promotions/components/promotion-state-tabs";
import {
	useArchiveDiscount,
	useDiscountsList,
	usePauseDiscount,
} from "@/features/promotions/hooks/use-discounts";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/promotions/")({
	component: PromotionsListPage,
	validateSearch: (search: Record<string, unknown>) => {
		const validStates: readonly PromotionState[] = [
			"all",
			"running",
			"scheduled",
			"paused",
			"expired",
			"archived",
		];
		const s = search.state;
		const state: PromotionState = validStates.includes(s as PromotionState)
			? (s as PromotionState)
			: "all";
		return {
			page: Number(search.page ?? 1),
			limit: Number(search.limit ?? 20),
			state,
		};
	},
});

const EMPTY_MESSAGE: Record<PromotionState, () => string> = {
	all: () => m.promotions_empty_all(),
	running: () => m.promotions_empty_running(),
	scheduled: () => m.promotions_empty_scheduled(),
	paused: () => m.promotions_empty_paused(),
	expired: () => m.promotions_empty_expired(),
	archived: () => m.promotions_empty_archived(),
};

interface DiscountRow {
	id: string;
	title: string;
	percent: number;
	startsAt: string;
	endsAt: string | null;
	status: "active" | "paused" | "archived";
	productCount: number;
}

const PERIOD_FMT_OPTS: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "short",
};

function PromotionsListPage() {
	"use no memo";

	const { page, limit, state } = Route.useSearch();
	const navigate = useNavigate({ from: "/promotions/" });

	const { data, isLoading, error } = useDiscountsList({ page, limit, state });
	const pauseMut = usePauseDiscount();
	const archiveMut = useArchiveDiscount();

	const goToTab = (next: PromotionState) =>
		void navigate({
			search: (prev) => ({ ...prev, state: next, page: 1 }),
		});

	const onPauseToggle = (id: string) => {
		pauseMut.mutate(id, {
			onSuccess: (res) =>
				toast.success(
					res?.data?.status === "paused"
						? m.promotions_toast_paused()
						: m.promotions_toast_resumed(),
				),
			onError: (e) => toast.error((e as Error).message),
		});
	};

	const onArchive = (id: string) => {
		archiveMut.mutate(id, {
			onSuccess: () => toast.success(m.promotions_toast_archived()),
			onError: (e) => toast.error((e as Error).message),
		});
	};

	const rows = useMemo<DiscountRow[]>(
		() =>
			(data?.data ?? []).map((d) => ({
				id: d.id,
				title: d.title,
				percent: d.percent,
				startsAt:
					typeof d.startsAt === "string"
						? d.startsAt
						: new Date(d.startsAt).toISOString(),
				endsAt:
					d.endsAt == null
						? null
						: typeof d.endsAt === "string"
							? d.endsAt
							: new Date(d.endsAt).toISOString(),
				status: d.status,
				productCount: d.productCount,
			})),
		[data],
	);

	const columns = useMemo<ColumnDef<DiscountRow>[]>(
		() => [
			{
				id: "title",
				header: () => m.promotions_col_title(),
				enableHiding: false,
				meta: {
					menuLabel: m.promotions_col_title(),
					cellClassName: "font-medium",
				},
				cell: ({ row }) => (
					<Link
						to="/promotions/$discountId"
						params={{ discountId: row.original.id }}
						className="hover:underline"
					>
						{row.original.title}
					</Link>
				),
			},
			{
				id: "discount",
				header: () => m.promotions_col_discount(),
				meta: {
					menuLabel: m.promotions_col_discount(),
					headerClassName: "w-24",
				},
				cell: ({ row }) => (
					<Badge variant="secondary">-{row.original.percent}%</Badge>
				),
			},
			{
				id: "period",
				header: () => m.promotions_col_period(),
				meta: {
					menuLabel: m.promotions_col_period(),
					cellClassName: "text-sm tabular-nums",
				},
				cell: ({ row }) => {
					const r = row.original;
					return (
						<>
							{new Date(r.startsAt).toLocaleDateString(
								"it-IT",
								PERIOD_FMT_OPTS,
							)}{" "}
							→{" "}
							{r.endsAt
								? new Date(r.endsAt).toLocaleDateString(
										"it-IT",
										PERIOD_FMT_OPTS,
									)
								: "∞"}
						</>
					);
				},
			},
			{
				id: "productCount",
				header: () => m.promotions_col_products(),
				meta: {
					menuLabel: m.promotions_col_products(),
					headerClassName: "w-24 text-right",
					cellClassName: "text-right tabular-nums",
				},
				cell: ({ row }) => row.original.productCount,
			},
			{
				id: "state",
				header: () => m.promotions_col_state(),
				enableHiding: false,
				meta: { menuLabel: m.promotions_col_state(), headerClassName: "w-32" },
				cell: ({ row }) => (
					<PromotionStateBadge
						status={row.original.status}
						startsAt={row.original.startsAt}
						endsAt={row.original.endsAt}
					/>
				),
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
									<Link
										to="/promotions/$discountId"
										params={{ discountId: r.id }}
									>
										{m.promotions_action_edit()}
									</Link>
								</DropdownMenuItem>
								{r.status !== "archived" && (
									<DropdownMenuItem onSelect={() => onPauseToggle(r.id)}>
										{r.status === "paused"
											? m.promotions_action_resume()
											: m.promotions_action_pause()}
									</DropdownMenuItem>
								)}
								{r.status !== "archived" && (
									<DropdownMenuItem onSelect={() => onArchive(r.id)}>
										{m.promotions_action_archive()}
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					);
				},
			},
		],
		[onPauseToggle, onArchive],
	);

	return (
		<div className="flex h-full min-w-0 flex-col gap-4">
			<div className="flex shrink-0 items-center justify-between">
				<div>
					<h1 className="font-display text-2xl font-semibold tracking-tight">
						{m.promotions_page_title()}
					</h1>
					<p className="text-muted-foreground text-sm">
						{m.promotions_page_subtitle()}
					</p>
				</div>
				<Button asChild>
					<Link to="/promotions/new">
						<CreateIcon />
						<span>{m.promotions_new_cta()}</span>
					</Link>
				</Button>
			</div>

			<div className="shrink-0">
				<PromotionStateTabs value={state} onChange={goToTab} />
			</div>

			{error && (
				<div className="bg-destructive/10 border-destructive/20 text-destructive shrink-0 rounded-lg border p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			<DataTable
				data={rows}
				columns={columns}
				storageKey="seller.promotions.columns"
				getRowId={(row) => row.id}
				isLoading={isLoading}
				containerClassName="flex-1 min-h-0 min-w-0 overflow-auto"
				hideHeaderWhenEmpty
				emptyState={
					state === "all" ? (
						<EmptyState
							title={EMPTY_MESSAGE.all()}
							description={m.promotions_empty_all_description()}
							action={
								<Button asChild>
									<Link to="/promotions/new">
										<CreateIcon />
										<span>{m.promotions_new_cta()}</span>
									</Link>
								</Button>
							}
						/>
					) : (
						<EmptyState title={EMPTY_MESSAGE[state]()} />
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
