import { cn } from "@bibs/ui/lib/utils";
import { m } from "@/paraglide/messages";

export type DiscountStatus = "active" | "paused" | "archived";
export type OperationalState =
	| "running"
	| "scheduled"
	| "paused"
	| "expired"
	| "archived";

interface Input {
	status: DiscountStatus;
	startsAt: string | Date;
	endsAt: string | Date | null;
}

export function operationalState(input: Input): OperationalState {
	if (input.status === "archived") return "archived";
	if (input.status === "paused") return "paused";
	const now = Date.now();
	const startsAt = new Date(input.startsAt).getTime();
	if (now < startsAt) return "scheduled";
	const endsAt = input.endsAt ? new Date(input.endsAt).getTime() : null;
	if (endsAt !== null && now > endsAt) return "expired";
	return "running";
}

const STATE_LABELS: Record<OperationalState, () => string> = {
	running: m.promotions_state_running,
	scheduled: m.promotions_state_scheduled,
	paused: m.promotions_state_paused,
	expired: m.promotions_state_expired,
	archived: m.promotions_state_archived,
};

const STATE_CLASSES: Record<OperationalState, string> = {
	running:
		"bg-emerald-50 text-emerald-700 ring-emerald-300/50 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30",
	scheduled:
		"bg-muted text-foreground/70 ring-foreground/10 dark:ring-foreground/20",
	paused:
		"bg-amber-50 text-amber-700 ring-amber-300/50 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30",
	expired:
		"bg-red-50 text-red-700 ring-red-300/50 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-500/30",
	archived:
		"bg-muted text-muted-foreground ring-foreground/10 dark:ring-foreground/20",
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
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
				STATE_CLASSES[state],
				className,
			)}
		>
			<span aria-hidden className="size-1.5 rounded-full bg-current" />
			{STATE_LABELS[state]()}
		</span>
	);
}
