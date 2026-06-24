import { Button } from "@bibs/ui/components/button";
import { toYMD } from "@bibs/ui/lib/date";
import { cn } from "@bibs/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	Boxes,
	ChevronRight,
	Clock,
	Package,
	Plus,
	Star,
	Store,
	Tag,
} from "lucide-react";
import { useActiveStore } from "@/hooks/use-active-store";
import { useStores } from "@/hooks/use-stores";

export const Route = createFileRoute("/_authenticated/")({
	component: Dashboard,
});

const TODAY_LABEL = "Venerdì 22 maggio";

const STATS = [
	{ label: "Ordini oggi", value: "—" },
	{ label: "Fatturato", value: "—" },
	{ label: "Prodotti attivi", value: "—" },
	{ label: "Promo in corso", value: "—" },
] as const;

type Urgency = "high" | "medium" | "low";

type ActionItem = {
	id: string;
	urgency: Urgency;
	title: string;
	subtitle: string;
	href: string;
	icon: React.ComponentType<{ className?: string }>;
};

// TODO: hydrate from real aggregations (orders, stock thresholds, promo
// expiry, store hours calendar, reviews feed) once those endpoints exist.
const ACTIONS: ActionItem[] = [
	{
		id: "orders-pending",
		urgency: "high",
		title: "3 ordini da preparare",
		subtitle: "Il più vecchio è arrivato 38 minuti fa",
		href: "/products",
		icon: Package,
	},
	{
		id: "stock-zero",
		urgency: "high",
		title: "2 prodotti esauriti",
		subtitle: "Riso Carnaroli premium · Tisana classico",
		href: "/products",
		icon: AlertTriangle,
	},
	{
		id: "stock-low",
		urgency: "medium",
		title: "5 prodotti con scorta bassa",
		subtitle: "Sotto le 5 unità",
		href: "/products",
		icon: Boxes,
	},
	{
		id: "promo-expiring",
		urgency: "medium",
		title: "Promo «Sconto estate» scade tra 2 giorni",
		subtitle: "Applicata a 4 prodotti, finora 38 utilizzi",
		href: "/promotions",
		icon: Tag,
	},
	{
		id: "reviews-new",
		urgency: "low",
		title: "2 nuove recensioni",
		subtitle: "Media 4,5★ negli ultimi 7 giorni",
		href: "/store",
		icon: Star,
	},
];

const URGENCY_DOT: Record<Urgency, string> = {
	high: "bg-brick",
	medium: "bg-cobalt",
	low: "bg-warm-shadow",
};

function Dashboard() {
	const { activeStore, stores, isLoading } = useActiveStore();
	const { data: storesList } = useStores();
	const openStatus =
		storesList?.find((s) => s.id === activeStore?.id)?.openStatus ?? null;

	const hoursAction: ActionItem | null =
		openStatus && !openStatus.isOpen
			? {
					id: "hours-status",
					urgency: openStatus.status === "closed_holiday" ? "medium" : "low",
					title:
						openStatus.status === "closed_holiday"
							? "Oggi il negozio è chiuso"
							: "Negozio chiuso ora",
					subtitle:
						openStatus.status === "closed_holiday"
							? "Festività o chiusura programmata"
							: openStatus.opensAt
								? `Riapre il ${toYMD(openStatus.opensAt.date)} alle ${openStatus.opensAt.time}`
								: "Nessun orario impostato",
					href: "/store/closures",
					icon: Clock,
				}
			: null;

	const actions: ActionItem[] = hoursAction
		? [...ACTIONS, hoursAction]
		: ACTIONS;

	if (!isLoading && stores.length === 0) {
		return <EmptyStoresState />;
	}

	return (
		<div className="mx-auto max-w-5xl space-y-10">
			<Hero
				name={activeStore?.name ?? "Il tuo negozio"}
				address={activeStore?.addressLine1 ?? ""}
				municipality={activeStore?.municipality?.name ?? ""}
			/>

			<StatsStrip />

			<ActionsList actions={actions} />
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
	name,
	address,
	municipality,
}: {
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
					{TODAY_LABEL}
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

function StatsStrip() {
	return (
		<dl className="flex flex-wrap items-baseline gap-x-6 gap-y-3 border-y border-border py-4 text-sm">
			{STATS.map((s, i) => (
				<div key={s.label} className="flex items-baseline gap-2">
					<dt className="text-muted-foreground">{s.label}</dt>
					<dd className="font-mono text-base font-medium text-foreground tabular-nums">
						{s.value}
					</dd>
					{i < STATS.length - 1 && (
						<span aria-hidden className="text-muted-foreground/40">
							·
						</span>
					)}
				</div>
			))}
		</dl>
	);
}

function ActionsList({ actions }: { actions: ActionItem[] }) {
	return (
		<section className="space-y-3">
			<div className="flex items-baseline justify-between gap-3">
				<h2 className="font-display text-lg font-semibold tracking-tight">
					Da gestire oggi
				</h2>
				<span className="font-mono text-xs text-muted-foreground">
					{actions.length} voci
				</span>
			</div>
			<ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
				{actions.map((a) => {
					const Icon = a.icon;
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
									<p className="truncate text-sm text-muted-foreground">
										{a.subtitle}
									</p>
								</div>
								<ChevronRight className="size-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5" />
							</Link>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
