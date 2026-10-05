import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { Spinner } from "@bibs/ui/components/spinner";
import { formatPriceEur } from "@bibs/ui/custom/price";
import { unwrap } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/billing/")({
	component: OverviewPage,
});

function OverviewPage() {
	const { data, isLoading, error } = useQuery({
		queryKey: ["admin", "billing", "overview"],
		queryFn: async () => {
			const r = await api().admin.billing.overview.get();
			return unwrap(r, m.billing_overview_load_error()).data;
		},
	});

	if (error)
		return (
			<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
				<p className="text-sm">
					{m.common_load_error_with_message({ message: error.message })}
				</p>
			</div>
		);
	if (isLoading || !data) return <Spinner />;

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<Card>
				<CardHeader>
					<CardTitle>{m.billing_mrr()}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-3xl font-semibold">
						{formatPriceEur(data.mrrCents / 100)}
					</p>
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
