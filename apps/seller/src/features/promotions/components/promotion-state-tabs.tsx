import { Tabs, TabsList, TabsTrigger } from "@bibs/ui/components/tabs";
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
	return (
		<Tabs value={value} onValueChange={(v) => onChange(v as PromotionState)}>
			<TabsList>
				{ORDER.map((s) => (
					<TabsTrigger key={s.value} value={s.value}>
						{s.label()}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	);
}
