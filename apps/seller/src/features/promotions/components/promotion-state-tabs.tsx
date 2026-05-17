import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import { m } from "@/paraglide/messages";

export type PromotionState =
	| "all"
	| "running"
	| "scheduled"
	| "paused"
	| "expired"
	| "archived";

interface Props {
	value: PromotionState;
	onChange: (v: PromotionState) => void;
}

const ORDER: { value: PromotionState; label: () => string }[] = [
	{ value: "all", label: () => m.promotions_state_all() },
	{ value: "running", label: () => m.promotions_state_running() },
	{ value: "scheduled", label: () => m.promotions_state_scheduled() },
	{ value: "paused", label: () => m.promotions_state_paused() },
	{ value: "expired", label: () => m.promotions_state_expired() },
	{ value: "archived", label: () => m.promotions_state_archived() },
];

export function PromotionStateTabs({ value, onChange }: Props) {
	const tabs: TabNavItem[] = ORDER.map((s) => ({
		value: s.value,
		label: s.label(),
	}));

	return (
		<TabNav
			tabs={tabs}
			activeTab={value}
			onTabChange={(v) => onChange(v as PromotionState)}
		/>
	);
}
