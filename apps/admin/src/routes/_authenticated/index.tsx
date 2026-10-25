import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { requestCountsQuery } from "@/features/requests/use-request-counts";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/")({
	component: Dashboard,
});

function Dashboard() {
	const { data: counts } = useQuery(requestCountsQuery);

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<Card>
				<CardHeader>
					<CardDescription>{m.dashboard_pending_requests()}</CardDescription>
					<CardTitle className="text-2xl tabular-nums">
						{counts?.total ?? "—"}
					</CardTitle>
				</CardHeader>
				<CardContent>
					<Link
						to="/requests"
						search={{ type: undefined }}
						className="text-xs text-muted-foreground hover:text-primary hover:underline"
					>
						{m.dashboard_pending_requests_open()}
					</Link>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>{m.dashboard_orders_today()}</CardDescription>
					<CardTitle className="text-2xl tabular-nums">0</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">
						{m.dashboard_no_orders()}
					</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>{m.dashboard_active_sellers()}</CardDescription>
					<CardTitle className="text-2xl tabular-nums">0</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">—</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>
						{m.dashboard_registered_customers()}
					</CardDescription>
					<CardTitle className="text-2xl tabular-nums">0</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">—</p>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>{m.dashboard_categories()}</CardDescription>
					<CardTitle className="text-2xl tabular-nums">0</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-xs text-muted-foreground">—</p>
				</CardContent>
			</Card>
		</div>
	);
}
