import { cn } from "@bibs/ui/lib/utils";
import { ORDER_STATUS_LABEL, type OrderStatus } from "../order-labels";

const AMBER =
	"bg-amber-50 text-amber-700 ring-amber-300/50 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-500/30";
const EMERALD =
	"bg-emerald-50 text-emerald-700 ring-emerald-300/50 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30";
const MUTED =
	"bg-muted text-muted-foreground ring-foreground/10 dark:ring-foreground/20";
const RED =
	"bg-red-50 text-red-700 ring-red-300/50 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-500/30";

const CLASSES: Record<OrderStatus, string> = {
	pending: AMBER,
	confirmed: AMBER,
	ready_for_pickup: EMERALD,
	shipped: EMERALD,
	delivered: MUTED,
	completed: MUTED,
	cancelled: RED,
	expired: RED,
};

export function OrderStatusBadge({
	status,
	className,
}: {
	status: OrderStatus;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-xs ring-1 ring-inset",
				CLASSES[status],
				className,
			)}
		>
			<span aria-hidden className="size-1.5 rounded-full bg-current" />
			{ORDER_STATUS_LABEL[status]()}
		</span>
	);
}
