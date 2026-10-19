import { cn } from "@bibs/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useStoreOrderTypes } from "@/features/stores/hooks/use-store-order-types";
import type { OrderType } from "@/features/stores/lib/order-types";
import { useActiveStore } from "@/hooks/use-active-store";
import { useIsOwner } from "@/hooks/use-is-owner";
import { m } from "@/paraglide/messages";

const TYPES: { type: OrderType; label: () => string }[] = [
	{ type: "reserve_pickup", label: m.orders_type_reserve_pickup },
	{ type: "pay_pickup", label: m.orders_type_pay_pickup },
];

/**
 * Come comprano i clienti nel negozio attivo, per tutti. Mostra le tipologie
 * offerte davvero (Paga e ritira senza incassi attivi risulta spento); solo il
 * titolare può aprire la scheda Vendita per cambiarle.
 */
export function OrderTypesSidebarCard() {
	const { activeStore } = useActiveStore();
	const isOwner = useIsOwner();
	const { data } = useStoreOrderTypes(activeStore?.id);
	if (!activeStore || !data) return null;

	const body = (
		<>
			<p className="pb-1 text-xs text-muted-foreground">
				{m.sidebar_order_types_title()}
			</p>
			{TYPES.map(({ type, label }) => {
				const on = data.offeredOrderTypes.includes(type);
				return (
					<div
						key={type}
						data-order-type={type}
						className="flex items-center gap-2"
					>
						<span
							aria-hidden
							className={cn(
								"size-2 shrink-0 rounded-full",
								on ? "bg-success" : "border border-muted-foreground",
							)}
						/>
						<span className={cn("flex-1", !on && "text-muted-foreground")}>
							{label()}
						</span>
						<span className="text-xs text-muted-foreground">
							{on ? m.sidebar_order_types_on() : m.sidebar_order_types_off()}
						</span>
					</div>
				);
			})}
		</>
	);
	const box =
		"block space-y-1 rounded-md border border-sidebar-border p-2.5 text-sm group-data-[collapsible=icon]:hidden";

	return isOwner ? (
		<Link
			to="/store"
			search={{ sezione: "vendita" }}
			className={cn(box, "hover:bg-sidebar-accent focus-visible:focus-ring")}
		>
			{body}
		</Link>
	) : (
		<div className={box}>{body}</div>
	);
}
