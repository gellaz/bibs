import { Button } from "@bibs/ui/components/button";
import { DataPagination } from "@bibs/ui/components/data-pagination";
import { PageSizeSelector } from "@bibs/ui/components/page-size-selector";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PlusIcon, TagIcon } from "lucide-react";
import { PromotionListTable } from "@/features/promotions/components/promotion-list-table";
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

function PromotionsListPage() {
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

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">{m.promotions_page_title()}</h1>
					<p className="text-muted-foreground text-sm">
						{m.promotions_page_subtitle()}
					</p>
				</div>
				<Button asChild>
					<Link to="/promotions/new">
						<PlusIcon />
						<span>{m.promotions_new_cta()}</span>
					</Link>
				</Button>
			</div>

			<PromotionStateTabs value={state} onChange={goToTab} />

			{error && (
				<div className="bg-destructive/10 border-destructive/20 text-destructive rounded-lg border p-4">
					<p className="text-sm">
						Errore nel caricamento: {(error as Error).message}
					</p>
				</div>
			)}

			{isLoading ? (
				<div className="bg-card flex h-64 items-center justify-center rounded-lg border">
					<Spinner className="size-8" />
				</div>
			) : data?.data && data.data.length > 0 ? (
				<div className="bg-card overflow-hidden rounded-lg border shadow-sm">
					<PromotionListTable
						rows={data.data.map((d) => ({
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
						}))}
						onPauseToggle={onPauseToggle}
						onArchive={onArchive}
					/>
				</div>
			) : (
				<div className="bg-card flex h-64 flex-col items-center justify-center gap-2 rounded-lg border">
					<TagIcon className="text-muted-foreground/40 size-8" />
					<p className="text-muted-foreground font-medium">
						{EMPTY_MESSAGE[state]()}
					</p>
				</div>
			)}

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
