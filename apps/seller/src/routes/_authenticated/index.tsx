import { Button } from "@bibs/ui/components/button";
import { formatPriceEur } from "@bibs/ui/components/price";
import { cn } from "@bibs/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	Boxes,
	ChevronRight,
	Clock,
	MapPinOff,
	Package,
	Plus,
	Store,
	Tag,
} from "lucide-react";
import {
	type ActionItem,
	type ActionKind,
	buildDashboardActions,
	formatTodayLabel,
	type Urgency,
} from "@/features/dashboard/dashboard-actions";
import { useActiveStore } from "@/hooks/use-active-store";
import { useStores } from "@/hooks/use-stores";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/")({
	component: Dashboard,
});

const URGENCY_DOT: Record<Urgency, string> = {
	high: "bg-brick",
	medium: "bg-cobalt",
	low: "bg-warm-shadow",
};

const ACTION_ICON: Record<
	ActionKind,
	React.ComponentType<{ className?: string }>
> = {
	location: MapPinOff,
	orders: Package,
	"out-of-stock": AlertTriangle,
	"low-stock": Boxes,
	promo: Tag,
	hours: Clock,
};

function useSellerDashboard(storeId: string | undefined) {
	return useQuery({
		queryKey: ["seller", "dashboard", storeId],
		queryFn: async () => {
			if (!storeId) throw new Error("No active store");
			const response = await api().seller.dashboard.get({
				query: { storeId },
			});
			return unwrap(response, m.dashboard_actions_error()).data;
		},
		enabled: !!storeId,
	});
}

function Dashboard() {
	const { activeStore, stores, isLoading } = useActiveStore();
	const { data: storesList } = useStores();
	const activeStoreRow = storesList?.find((s) => s.id === activeStore?.id);
	const dashboard = useSellerDashboard(activeStore?.id);

	// I tempi relativi ("38 minuti fa") e la data in testata si riferiscono
	// all'istante in cui sono arrivati i numeri, non a un render qualsiasi.
	const now = new Date(dashboard.dataUpdatedAt || Date.now());

	const actions = buildDashboardActions({
		dashboard: dashboard.data?.actions ?? null,
		locationMissing: !!activeStoreRow && !activeStoreRow.location,
		openStatus: activeStoreRow?.openStatus ?? null,
		now,
	});

	if (!isLoading && stores.length === 0) {
		return <EmptyStoresState />;
	}

	const stats = dashboard.data?.stats;

	return (
		<div className="mx-auto max-w-5xl space-y-10">
			<Hero
				todayLabel={formatTodayLabel(now)}
				name={activeStore?.name ?? "Il tuo negozio"}
				address={activeStore?.addressLine1 ?? ""}
				municipality={activeStore?.municipality?.name ?? ""}
			/>

			<StatsStrip
				stats={[
					{
						label: m.dashboard_stat_orders_today(),
						value: stats ? String(stats.ordersToday) : "—",
					},
					{
						label: m.dashboard_stat_revenue_today(),
						value: stats ? formatPriceEur(stats.revenueToday) : "—",
					},
					{
						label: m.dashboard_stat_active_products(),
						value: stats ? String(stats.activeProducts) : "—",
					},
					{
						label: m.dashboard_stat_active_promotions(),
						value: stats ? String(stats.activePromotions) : "—",
					},
				]}
			/>

			<ActionsList
				actions={actions}
				isLoading={dashboard.isLoading}
				isError={dashboard.isError}
			/>
		</div>
	);
}

function EmptyStoresState() {
	return (
		<div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-6 py-24 text-center">
			<div
				aria-hidden
				className="flex size-16 items-center justify-center rounded-2xl bg-cobalt-soft text-cobalt-deep"
			>
				<Store className="size-8" />
			</div>
			<div className="space-y-2">
				<h1 className="font-display text-3xl font-bold tracking-tight">
					Apri il tuo primo negozio
				</h1>
				<p className="text-muted-foreground">
					Per iniziare a vendere su bibs devi attivare il tuo primo punto
					vendita. L'abbonamento mensile parte solo dopo che confermi il
					pagamento.
				</p>
			</div>
			<Button asChild size="lg">
				<Link to="/store/new">
					<Plus className="size-4" />
					Aggiungi il primo negozio
				</Link>
			</Button>
		</div>
	);
}

function Hero({
	todayLabel,
	name,
	address,
	municipality,
}: {
	todayLabel: string;
	name: string;
	address: string;
	municipality: string;
}) {
	const subtitle = [address, municipality].filter(Boolean).join(" · ");

	return (
		<header className="flex items-center gap-5">
			<div
				aria-hidden
				className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-cobalt-soft text-cobalt-deep"
			>
				<Store className="size-6" />
			</div>
			<div className="min-w-0 flex-1 space-y-1">
				<p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
					{todayLabel}
				</p>
				<h1 className="truncate font-display text-3xl font-bold tracking-tight">
					{name}
				</h1>
				{subtitle && (
					<p className="truncate text-sm text-muted-foreground">{subtitle}</p>
				)}
			</div>
		</header>
	);
}

function StatsStrip({ stats }: { stats: { label: string; value: string }[] }) {
	return (
		<dl className="flex flex-wrap items-baseline gap-x-6 gap-y-3 border-y border-border py-4 text-sm">
			{stats.map((s, i) => (
				<div key={s.label} className="flex items-baseline gap-2">
					<dt className="text-muted-foreground">{s.label}</dt>
					<dd className="font-mono text-base font-medium text-foreground tabular-nums">
						{s.value}
					</dd>
					{i < stats.length - 1 && (
						<span aria-hidden className="text-muted-foreground/40">
							·
						</span>
					)}
				</div>
			))}
		</dl>
	);
}

function ActionsList({
	actions,
	isLoading,
	isError,
}: {
	actions: ActionItem[];
	isLoading: boolean;
	isError: boolean;
}) {
	return (
		<section className="space-y-3">
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="font-display text-lg font-semibold tracking-tight">
					{m.dashboard_actions_title()}
				</h2>
				{!isLoading && (
					<span className="font-mono text-xs text-muted-foreground">
						{m.dashboard_actions_count({ count: actions.length })}
					</span>
				)}
			</div>
			{isError && (
				<p role="alert" className="text-sm text-destructive">
					{m.dashboard_actions_error()}
				</p>
			)}
			{actions.length > 0 ? (
				<ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
					{actions.map((a) => {
						const Icon = ACTION_ICON[a.kind];
						return (
							<li key={a.id}>
								<Link
									to={a.href}
									className={cn(
										"group flex items-center gap-4 px-5 py-4 transition-colors",
										"hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none",
									)}
								>
									<span
										aria-hidden
										className={cn(
											"size-2 shrink-0 rounded-full",
											URGENCY_DOT[a.urgency],
										)}
									/>
									<Icon className="size-5 shrink-0 text-muted-foreground" />
									<div className="min-w-0 flex-1">
										<p className="truncate text-base font-medium text-foreground">
											{a.title}
										</p>
										{a.subtitle && (
											<p className="truncate text-sm text-muted-foreground">
												{a.subtitle}
											</p>
										)}
									</div>
									<ChevronRight className="size-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</li>
						);
					})}
				</ul>
			) : (
				!isLoading &&
				!isError && (
					<p className="rounded-lg border border-dashed border-border px-5 py-6 text-sm text-muted-foreground">
						{m.dashboard_actions_empty()}
					</p>
				)
			)}
		</section>
	);
}
