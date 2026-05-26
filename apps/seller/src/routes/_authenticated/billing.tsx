import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@bibs/ui/components/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { SectionHeader } from "@/components/section-header";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/billing")({
	component: BillingPage,
});

const STATUS_BADGE: Record<
	string,
	{
		label: string;
		variant: "default" | "secondary" | "destructive" | "outline";
	}
> = {
	active: { label: "Attivo", variant: "default" },
	past_due: { label: "Rinnovo fallito", variant: "destructive" },
	canceling: { label: "In cancellazione", variant: "outline" },
	suspended: { label: "Sospeso", variant: "destructive" },
};

function formatEuro(cents: number): string {
	return `€${(cents / 100).toFixed(2)}`;
}

const dateFormatter = new Intl.DateTimeFormat("it-IT", {
	day: "numeric",
	month: "long",
	year: "numeric",
});

const dateFormatterShort = new Intl.DateTimeFormat("it-IT", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

function formatDate(d: Date | string, short = false): string {
	return short
		? dateFormatterShort.format(new Date(d))
		: dateFormatter.format(new Date(d));
}

function BillingPage() {
	const { data: summary, isLoading: summaryLoading } = useQuery({
		queryKey: ["seller", "billing", "summary"],
		queryFn: async () => {
			const r = await api().seller.billing.summary.get();
			if (r.error) throw new Error((r.error.value as any)?.message);
			return r.data?.data;
		},
	});

	const { data: subs, isLoading: subsLoading } = useQuery({
		queryKey: ["seller", "billing", "subscriptions"],
		queryFn: async () => {
			const r = await api().seller.billing.subscriptions.get();
			if (r.error) throw new Error((r.error.value as any)?.message);
			return r.data?.data ?? [];
		},
	});

	const portalMutation = useMutation({
		mutationFn: async () => {
			const r = await api().seller.billing.portal.post();
			if (r.error) throw new Error((r.error.value as any)?.message);
			return r.data?.data;
		},
		onSuccess: (data) => {
			if (data?.url) window.location.href = data.url;
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className="space-y-6">
			<SectionHeader
				title="Billing"
				subtitle="Riepilogo dei pagamenti e dei rinnovi"
			/>

			<Card>
				<CardHeader>
					<CardTitle>Riepilogo</CardTitle>
					<CardDescription>
						I tuoi negozi attivi e i prossimi rinnovi.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{summaryLoading || !summary ? (
						<Spinner />
					) : summary.activeStoresCount === 0 ? (
						<p className="text-muted-foreground text-sm">
							Non hai ancora negozi attivi.
						</p>
					) : (
						<div className="flex flex-col gap-4">
							<p className="text-base">
								Stai pagando{" "}
								<strong>{formatEuro(summary.totalMonthlyCents)}/mese</strong>{" "}
								per <strong>{summary.activeStoresCount}</strong>{" "}
								{summary.activeStoresCount === 1
									? "negozio attivo"
									: "negozi attivi"}
								.
							</p>
							{summary.nextRenewal && (
								<p className="text-muted-foreground text-sm">
									Prossimo rinnovo:{" "}
									<strong>{formatDate(summary.nextRenewal.date)}</strong> per{" "}
									<strong>{summary.nextRenewal.storeName}</strong> (
									{formatEuro(summary.nextRenewal.amountCents)}).
								</p>
							)}
							<div>
								<Button
									variant="outline"
									onClick={() => portalMutation.mutate()}
									disabled={portalMutation.isPending}
								>
									{portalMutation.isPending ? (
										<Spinner />
									) : (
										"Gestisci pagamenti su Stripe"
									)}
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Abbonamenti per negozio</CardTitle>
				</CardHeader>
				<CardContent>
					{subsLoading ? (
						<Spinner />
					) : !subs || subs.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							Nessun abbonamento attivo.
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Negozio</TableHead>
									<TableHead>Stato</TableHead>
									<TableHead>Quota</TableHead>
									<TableHead>Prossimo rinnovo</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{subs.map((s) => {
									const badge = STATUS_BADGE[s.status] ?? {
										label: s.status,
										variant: "outline" as const,
									};
									const periodLabel =
										s.status === "suspended"
											? `Scaduto il ${formatDate(s.currentPeriodEnd, true)}`
											: s.status === "canceling"
												? `Disattivazione ${formatDate(s.currentPeriodEnd, true)}`
												: formatDate(s.currentPeriodEnd, true);
									return (
										<TableRow key={s.storeId}>
											<TableCell>{s.storeName}</TableCell>
											<TableCell>
												<Badge variant={badge.variant}>{badge.label}</Badge>
											</TableCell>
											<TableCell>{formatEuro(s.feeAmountCents)}/mese</TableCell>
											<TableCell>{periodLabel}</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
