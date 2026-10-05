import { Badge } from "@bibs/ui/components/badge";
import { m } from "@/paraglide/messages";

export type MembershipStatus = "active" | "pending" | "banned" | "removed";

type StatusConfig = {
	border: string;
	bg: string;
	text: string;
	dot: string;
};

const STATUS_STYLES: Record<MembershipStatus, StatusConfig> = {
	active: {
		border: "border-olive/50",
		bg: "bg-olive/10 dark:bg-olive/20",
		text: "text-olive",
		dot: "bg-olive",
	},
	pending: {
		border: "border-saffron-deep/50",
		bg: "bg-saffron/15 dark:bg-saffron/20",
		text: "text-saffron-deep",
		dot: "bg-saffron-deep",
	},
	banned: {
		border: "border-brick/50",
		bg: "bg-brick/10 dark:bg-brick/20",
		text: "text-brick",
		dot: "bg-brick",
	},
	removed: {
		border: "border-warm-shadow/40",
		bg: "bg-transparent",
		text: "text-warm-shadow",
		dot: "bg-warm-shadow/70",
	},
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
	const config = STATUS_STYLES[status as MembershipStatus];
	if (!config) {
		return (
			<Badge variant="outline" className={className}>
				{status}
			</Badge>
		);
	}
	return (
		<Badge
			variant="outline"
			className={[config.border, config.bg, config.text, className]
				.filter(Boolean)
				.join(" ")}
		>
			<span
				aria-hidden="true"
				className={`size-1.5 shrink-0 rounded-full ${config.dot}`}
			/>
			{statusLabel(status as MembershipStatus)}
		</Badge>
	);
}
