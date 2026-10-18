import { StatusBadge, type StatusTone } from "@bibs/ui/custom/status-badge";
import {
	BanIcon,
	CircleCheckIcon,
	CircleHelpIcon,
	HourglassIcon,
	type LucideIcon,
	UserXIcon,
} from "lucide-react";
import { m } from "@/paraglide/messages";

export type MembershipStatus = "active" | "pending" | "banned" | "removed";

const STATUS_BADGE: Record<
	MembershipStatus,
	{ tone: StatusTone; icon: LucideIcon }
> = {
	active: { tone: "success", icon: CircleCheckIcon },
	pending: { tone: "waiting", icon: HourglassIcon },
	banned: { tone: "destructive", icon: BanIcon },
	removed: { tone: "closed", icon: UserXIcon },
};

// Funzione e non costante: le etichette vanno lette a ogni render, dopo un
// cambio di lingua.
function statusLabel(status: MembershipStatus): string {
	switch (status) {
		case "active":
			return m.team_status_active();
		case "pending":
			return m.team_status_pending();
		case "banned":
			return m.team_status_banned();
		case "removed":
			return m.team_status_removed();
	}
}

type Props = {
	status: MembershipStatus | string;
	className?: string;
};

export function MembershipStatusBadge({ status, className }: Props) {
	const config = STATUS_BADGE[status as MembershipStatus];
	if (!config) {
		return (
			<StatusBadge tone="closed" icon={CircleHelpIcon} className={className}>
				{status}
			</StatusBadge>
		);
	}
	return (
		<StatusBadge tone={config.tone} icon={config.icon} className={className}>
			{statusLabel(status as MembershipStatus)}
		</StatusBadge>
	);
}
