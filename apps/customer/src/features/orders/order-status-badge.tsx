import { StatusBadge, type StatusTone } from "@bibs/ui/custom/status-badge";
import {
	CircleCheckIcon,
	CircleXIcon,
	CreditCardIcon,
	type LucideIcon,
	PackageCheckIcon,
	PackageIcon,
	ShoppingBagIcon,
	TimerOffIcon,
	TruckIcon,
} from "lucide-react";
import { CUSTOMER_ORDER_STATUS, type OrderStatus } from "./order-display";

// Toni per chi compra: pagare e andare a ritirare toccano a lui, il resto lo
// fa il negozio.
const BADGE: Record<OrderStatus, { tone: StatusTone; icon: LucideIcon }> = {
	pending: { tone: "action", icon: CreditCardIcon },
	confirmed: { tone: "waiting", icon: PackageIcon },
	ready_for_pickup: { tone: "action", icon: ShoppingBagIcon },
	shipped: { tone: "waiting", icon: TruckIcon },
	delivered: { tone: "closed", icon: PackageCheckIcon },
	completed: { tone: "closed", icon: CircleCheckIcon },
	cancelled: { tone: "destructive", icon: CircleXIcon },
	expired: { tone: "destructive", icon: TimerOffIcon },
};

export function OrderStatusBadge({
	status,
	className,
}: {
	status: OrderStatus;
	className?: string;
}) {
	const { tone, icon } = BADGE[status];
	return (
		<StatusBadge tone={tone} icon={icon} className={className}>
			{CUSTOMER_ORDER_STATUS[status]()}
		</StatusBadge>
	);
}
