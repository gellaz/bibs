import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/")({
	component: Dashboard,
});

function Dashboard() {
	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
