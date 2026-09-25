import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import { m } from "@/paraglide/messages";
import type { OrderStatus } from "../order-labels";

export type OrderTab =
	| "all"
	| "pending"
	| "confirmed"
	| "ready_for_pickup"
	| "completed"
	| "cancelled"
	| "expired";
export const ORDER_TABS: readonly OrderTab[] = [
	"all",
	"pending",
	"confirmed",
	"ready_for_pickup",
	"completed",
	"cancelled",
	"expired",
];

/** Tab = insieme di ordini: al plurale. */
const LABEL: Record<OrderTab, () => string> = {
	all: m.orders_tab_all,
	pending: m.orders_tab_pending,
	confirmed: m.orders_tab_confirmed,
	ready_for_pickup: m.orders_tab_ready_for_pickup,
	completed: m.orders_tab_completed,
	cancelled: m.orders_tab_cancelled,
	expired: m.orders_tab_expired,
};

export function OrderStatusTabs({
	value,
	onChange,
	counts,
}: {
	value: OrderTab;
	onChange: (v: OrderTab) => void;
	counts?: Record<string, number>;
}) {
	const total = counts
		? Object.values(counts).reduce((s, n) => s + n, 0)
		: undefined;
	const tabs: TabNavItem[] = ORDER_TABS.map((t) => ({
		value: t,
		label: LABEL[t](),
		count: t === "all" ? total : counts?.[t as OrderStatus],
	}));
	return (
		<TabNav
			tabs={tabs}
			activeTab={value}
			onTabChange={(v) => onChange(v as OrderTab)}
		/>
	);
}
