import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { cn } from "@bibs/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Sparkles, TriangleAlert } from "lucide-react";
import { Notice } from "@/components/notice";
import { type PointRow, toPointRow } from "@/features/points/point-display";
import {
	POINTS_PAGE_SIZE,
	useCustomerPoints,
} from "@/features/points/use-points";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/points")({
	component: PointsPage,
	validateSearch: (search: Record<string, unknown>) => ({
		page: Math.max(1, Number(search.page) || 1),
	}),
});

const shortId = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;
const DATE_FMT: Intl.DateTimeFormatOptions = {
	day: "numeric",
	month: "short",
	year: "numeric",
};

function PointsPage() {
	const { page } = Route.useSearch();
	const { data, isPending, isError, refetch } = useCustomerPoints(page);
	const rows = (data?.transactions ?? []).map(toPointRow);
	const total = data?.pagination.total ?? 0;
	const pages = Math.ceil(total / POINTS_PAGE_SIZE);

	return (
		<div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
			<h1 className="font-display font-semibold text-2xl text-foreground">
				{m.points_title()}
			</h1>

			{isPending ? (
				<div className="space-y-3">
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-16 w-full" />
				</div>
			) : isError ? (
				<Notice
					icon={TriangleAlert}
					title={m.points_load_failed()}
					description={m.points_empty_description()}
					action={
						<Button variant="secondary" onClick={() => refetch()}>
							{m.cart_retry()}
						</Button>
					}
				/>
			) : (
				<>
					<section className="rounded-xl border border-border p-5">
						<h2 className="font-medium text-muted-foreground text-sm">
							{m.points_balance()}
						</h2>
						<p className="mt-1 flex items-baseline gap-2">
							<span className="font-mono font-semibold text-4xl text-foreground tabular-nums">
								{data.balance}
							</span>
							<span className="font-medium text-muted-foreground text-sm tracking-[0.04em]">
								{m.profile_points_label()}
							</span>
						</p>
					</section>

					<section className="space-y-3">
						<h2 className="font-display font-semibold text-foreground text-lg">
							{m.points_history()}
						</h2>
						{rows.length === 0 ? (
							<Notice
								icon={Sparkles}
								title={m.points_empty_title()}
								description={m.points_empty_description()}
								action={
									<Button asChild>
										<Link
											to="/stores"
											search={{ q: undefined, categoryId: undefined }}
										>
											{m.cart_empty_cta()}
										</Link>
									</Button>
								}
							/>
						) : (
							// L'hover della riga segue gli angoli della lista senza
							// overflow-hidden, che taglierebbe l'anello di focus.
							<ul className="divide-y divide-border rounded-xl border border-border [&>li:first-child>*]:rounded-t-xl [&>li:last-child>*]:rounded-b-xl">
								{rows.map((row) => (
									<li key={row.id}>
										<PointRowItem row={row} />
									</li>
								))}
							</ul>
						)}
					</section>
				</>
			)}

			{pages > 1 && (
				<div className="flex justify-between">
					{page > 1 ? (
						<Button asChild variant="secondary" className="min-h-11">
							<Link
								to="/points"
								search={{ page: page - 1 }}
								aria-label={m.points_page_prev()}
							>
								←
							</Link>
						</Button>
					) : (
						<span />
					)}
					{page < pages && (
						<Button asChild variant="secondary" className="min-h-11">
							<Link
								to="/points"
								search={{ page: page + 1 }}
								aria-label={m.points_page_next()}
							>
								→
							</Link>
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

/** Una riga: tipo e importo con segno in testa, data e ordine sotto. Con un
 *  ordine la riga intera è un link al dettaglio. */
function PointRowItem({ row }: { row: PointRow }) {
	const body = (
		<>
			<span className="min-w-0 flex-1 space-y-0.5">
				<span className="block font-medium text-foreground">{row.label}</span>
				<span className="block text-muted-foreground text-sm tabular-nums">
					{row.createdAt.toLocaleDateString(intlLocale(), DATE_FMT)}
					{row.orderId &&
						` · ${m.orders_order_number({ number: shortId(row.orderId) })}`}
				</span>
				{row.note && (
					<span className="block text-muted-foreground text-sm">
						{row.note}
					</span>
				)}
			</span>
			<span
				className={cn(
					"shrink-0 font-mono font-semibold tabular-nums",
					row.gain ? "text-foreground" : "text-muted-foreground",
				)}
			>
				{row.points}
			</span>
		</>
	);

	if (!row.orderId)
		return <div className="flex items-center gap-3 p-4">{body}</div>;

	return (
		<Link
			to="/orders/$orderId"
			params={{ orderId: row.orderId }}
			className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50"
		>
			{body}
			<ChevronRight
				className="size-5 shrink-0 text-muted-foreground"
				aria-hidden
			/>
		</Link>
	);
}
