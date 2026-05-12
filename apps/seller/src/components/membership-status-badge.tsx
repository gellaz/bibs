import { Badge } from "@bibs/ui/components/badge";

export type MembershipStatus = "active" | "pending" | "banned" | "removed";

type StatusConfig = {
	label: string;
	border: string;
	bg: string;
	text: string;
	dot: string;
};

const STATUS_STYLES: Record<MembershipStatus, StatusConfig> = {
	active: {
		label: "Attivo",
		border: "border-olive/50",
		bg: "bg-olive/10 dark:bg-olive/20",
		text: "text-olive",
		dot: "bg-olive",
	},
	pending: {
		label: "In attesa",
		border: "border-saffron-deep/50",
		bg: "bg-saffron/15 dark:bg-saffron/20",
		text: "text-saffron-deep",
		dot: "bg-saffron-deep",
	},
	banned: {
		label: "Sospeso",
		border: "border-brick/50",
		bg: "bg-brick/10 dark:bg-brick/20",
		text: "text-brick",
		dot: "bg-brick",
	},
	removed: {
		label: "Rimosso",
		border: "border-warm-shadow/40",
		bg: "bg-transparent",
		text: "text-warm-shadow",
		dot: "bg-warm-shadow/70",
	},
};

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
			{config.label}
		</Badge>
	);
}
