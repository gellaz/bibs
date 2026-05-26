import { Tabs, TabsList, TabsTrigger } from "@bibs/ui/components/tabs";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/billing")({
	component: BillingLayout,
});

function BillingLayout() {
	const location = useLocation();
	const value = location.pathname.endsWith("/pricing")
		? "pricing"
		: location.pathname.endsWith("/subscriptions")
			? "subscriptions"
			: "overview";

	return (
		<div className="space-y-4">
			<PageHeader
				title="Billing"
				description="Gestisci pricing e abbonamenti seller"
			/>
			<Tabs value={value}>
				<TabsList>
					<TabsTrigger value="overview" asChild>
						<Link to="/billing">Overview</Link>
					</TabsTrigger>
					<TabsTrigger value="pricing" disabled>
						Pricing
					</TabsTrigger>
					<TabsTrigger value="subscriptions" disabled>
						Abbonamenti
					</TabsTrigger>
				</TabsList>
			</Tabs>
			<Outlet />
		</div>
	);
}
