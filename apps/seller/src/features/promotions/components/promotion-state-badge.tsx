import { StatusBadge, type StatusTone } from "@bibs/ui/custom/status-badge";
import {
	CalendarClockIcon,
	CirclePauseIcon,
	CirclePlayIcon,
	FlagIcon,
	type LucideIcon,
} from "lucide-react";
import { m } from "@/paraglide/messages";

export type DiscountStatus = "active" | "paused" | "archived";
export type OperationalState = "running" | "scheduled" | "paused" | "concluded";

interface Input {
	status: DiscountStatus;
	startsAt: string | Date;
	endsAt: string | Date | null;
}

export function operationalState(input: Input): OperationalState {
	if (input.status === "archived") return "concluded";
	if (input.status === "paused") return "paused";
	const now = Date.now();
	const startsAt = new Date(input.startsAt).getTime();
	if (now < startsAt) return "scheduled";
	const endsAt = input.endsAt ? new Date(input.endsAt).getTime() : null;
	if (endsAt !== null && now > endsAt) return "concluded";
	return "running";
}

const STATE_LABELS: Record<OperationalState, () => string> = {
	running: m.promotions_state_running,
	scheduled: m.promotions_state_scheduled,
	paused: m.promotions_state_paused,
	concluded: m.promotions_state_concluded,
};

const STATE_BADGE: Record<
	OperationalState,
	{ tone: StatusTone; icon: LucideIcon }
> = {
	running: { tone: "success", icon: CirclePlayIcon },
	scheduled: { tone: "waiting", icon: CalendarClockIcon },
	paused: { tone: "closed", icon: CirclePauseIcon },
	concluded: { tone: "closed", icon: FlagIcon },
};

interface Props {
	status: DiscountStatus;
	startsAt: string | Date;
	endsAt: string | Date | null;
	className?: string;
}

export function PromotionStateBadge({
	status,
	startsAt,
	endsAt,
	className,
}: Props) {
	const state = operationalState({ status, startsAt, endsAt });
	const { tone, icon } = STATE_BADGE[state];
	return (
		<StatusBadge tone={tone} icon={icon} className={className}>
			{STATE_LABELS[state]()}
		</StatusBadge>
	);
}
