import { Tabs, TabsList, TabsTrigger } from "@bibs/ui/components/tabs";
import { PageHeader } from "@bibs/ui/custom/page-header";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
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
					<TabsTrigger
						value="overview"
						nativeButton={false}
						render={<Link to="/billing" />}
					>
						{m.billing_tab_overview()}
					</TabsTrigger>
					<TabsTrigger
						value="pricing"
						nativeButton={false}
						render={<Link to="/billing/pricing" />}
					>
						{m.billing_tab_pricing()}
					</TabsTrigger>
					<TabsTrigger
						value="subscriptions"
						nativeButton={false}
						render={<Link to="/billing/subscriptions" />}
					>
						{m.billing_tab_subscriptions()}
					</TabsTrigger>
				</TabsList>
			</Tabs>
			<Outlet />
		</div>
	);
}
