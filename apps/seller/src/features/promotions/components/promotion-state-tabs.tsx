import { TabNav, type TabNavItem } from "@bibs/ui/components/tab-nav";
import { m } from "@/paraglide/messages";

export type PromotionState = "assignable" | "concluded";

interface Props {
	value: PromotionState;
	onChange: (v: PromotionState) => void;
}

const ORDER: { value: PromotionState; label: () => string }[] = [
	{ value: "assignable", label: () => m.promotions_tab_active() },
	{ value: "concluded", label: () => m.promotions_tab_concluded() },
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
