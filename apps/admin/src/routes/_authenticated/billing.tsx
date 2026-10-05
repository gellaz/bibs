import { Tabs, TabsList, TabsTrigger } from "@bibs/ui/components/tabs";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { m } from "@/paraglide/messages";

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
				title={m.billing_title()}
				description={m.billing_description()}
			/>
			<Tabs value={value}>
				<TabsList>
					<TabsTrigger value="overview" asChild>
						<Link to="/billing">{m.billing_tab_overview()}</Link>
					</TabsTrigger>
					<TabsTrigger value="pricing" asChild>
						<Link to="/billing/pricing">{m.billing_tab_pricing()}</Link>
					</TabsTrigger>
					<TabsTrigger value="subscriptions" asChild>
						<Link to="/billing/subscriptions">
							{m.billing_tab_subscriptions()}
						</Link>
					</TabsTrigger>
				</TabsList>
			</Tabs>
			<Outlet />
		</div>
	);
}
