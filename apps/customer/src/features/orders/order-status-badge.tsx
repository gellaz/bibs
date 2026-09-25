import { cn } from "@bibs/ui/lib/utils";
import { CUSTOMER_ORDER_STATUS, type OrderStatus } from "./order-display";

// «Pronto per il ritiro» è il momento in cui il cliente deve muoversi: pallino
// saffron (segnale), testo Ink per il contrasto. Il resto resta quieto.
const CLASSES: Record<OrderStatus, { pill: string; dot: string }> = {
	pending: { pill: "bg-muted text-foreground", dot: "bg-muted-foreground" },
	confirmed: { pill: "bg-muted text-foreground", dot: "bg-muted-foreground" },
	ready_for_pickup: {
		pill: "bg-saffron/15 text-foreground",
		dot: "bg-saffron",
	},
	shipped: { pill: "bg-muted text-foreground", dot: "bg-muted-foreground" },
	delivered: { pill: "bg-muted text-muted-foreground", dot: "bg-current" },
	completed: { pill: "bg-muted text-muted-foreground", dot: "bg-current" },
	cancelled: { pill: "bg-muted text-destructive", dot: "bg-current" },
	expired: { pill: "bg-muted text-destructive", dot: "bg-current" },
};

export function OrderStatusBadge({
	status,
	className,
}: {
	status: OrderStatus;
	className?: string;
}) {
	const c = CLASSES[status];
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-xs",
				c.pill,
				className,
			)}
		>
			<span aria-hidden className={cn("size-1.5 rounded-full", c.dot)} />
			{CUSTOMER_ORDER_STATUS[status]()}
		</span>
	);
}
