import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { Spinner } from "@bibs/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/billing/")({
	component: OverviewPage,
});

function formatEuro(cents: number) {
	return `€${(cents / 100).toFixed(2)}`;
}

function OverviewPage() {
	const { data, isLoading } = useQuery({
		queryKey: ["admin", "billing", "overview"],
		queryFn: async () => {
			const r = await api().admin.billing.overview.get();
			if (r.error) throw new Error(r.error.value?.message);
			return r.data?.data;
		},
	});

	if (isLoading || !data) return <Spinner />;

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<Card>
				<CardHeader>
					<CardTitle>{m.billing_mrr()}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-3xl font-semibold">{formatEuro(data.mrrCents)}</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>{m.billing_active_stores()}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-3xl font-semibold">{data.activeStoresCount}</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>{m.billing_past_due()}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-3xl font-semibold">{data.pastDueCount}</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>{m.billing_suspended()}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-3xl font-semibold">{data.suspendedCount}</p>
				</CardContent>
			</Card>
		</div>
	);
}
