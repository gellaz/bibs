import { useEffect, useState } from "react";
import { m } from "@/paraglide/messages";
import { formatCountdown, pickupDeadline } from "./order-display";

/** Tick al secondo solo finché la prenotazione è aperta. */
function useNow(active: boolean) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [active]);
	return now;
}

export function PickupCountdown({ expiresAt }: { expiresAt: Date | string }) {
	const end = new Date(expiresAt).getTime();
	const now = useNow(Date.now() < end);
	const { expired, date } = pickupDeadline(expiresAt, now);
	if (expired)
		return (
			<span className="text-muted-foreground text-sm">
				{m.orders_pickup_expired()}
			</span>
		);
	return (
		<span className="text-sm">
			{m.orders_pickup_by({ date })}
			<span aria-hidden className="text-muted-foreground">
				{" · "}
			</span>
			<span
				role="timer"
				aria-live="off"
				className="font-medium text-foreground tabular-nums"
			>
				{formatCountdown(end - now)}
			</span>
		</span>
	);
}
