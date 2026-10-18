import { StatusBadge, type StatusTone } from "@bibs/ui/custom/status-badge";
import {
	CircleCheckIcon,
	CircleXIcon,
	HourglassIcon,
	type LucideIcon,
	PackageCheckIcon,
	PackageIcon,
	ShoppingBagIcon,
	TimerOffIcon,
	TruckIcon,
} from "lucide-react";
import { ORDER_STATUS_LABEL, type OrderStatus } from "../order-labels";

// Toni per chi vende: «da preparare» tocca a lui, il pagamento al cliente.
const BADGE: Record<OrderStatus, { tone: StatusTone; icon: LucideIcon }> = {
	pending: { tone: "waiting", icon: HourglassIcon },
	confirmed: { tone: "action", icon: PackageIcon },
	ready_for_pickup: { tone: "success", icon: ShoppingBagIcon },
	shipped: { tone: "success", icon: TruckIcon },
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
			{ORDER_STATUS_LABEL[status]()}
		</StatusBadge>
	);
}
