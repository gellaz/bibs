import { Badge } from "@bibs/ui/components/badge";
import { cn } from "@bibs/ui/lib/utils";
import { m } from "@/paraglide/messages";

type OnboardingStatus =
	| "pending_email"
	| "pending_personal"
	| "pending_document"
	| "pending_company"
	| "pending_store"
	| "pending_payment"
	| "pending_review"
	| "active"
	| "rejected";

const statusConfig: Record<
	OnboardingStatus,
	{
		label: () => string;
		variant: "secondary" | "destructive" | "outline";
		className?: string;
	}
> = {
	pending_email: {
		label: m.sellers_status_pending_email,
		variant: "secondary",
	},
	pending_personal: {
		label: m.sellers_status_pending_personal,
		variant: "secondary",
	},
	pending_document: {
		label: m.sellers_status_pending_document,
		variant: "secondary",
	},
	pending_company: {
		label: m.sellers_status_pending_company,
		variant: "secondary",
	},
	pending_store: {
		label: m.sellers_status_pending_store,
		variant: "secondary",
	},
	pending_payment: {
		label: m.sellers_status_pending_payment,
		variant: "secondary",
	},
	pending_review: {
		label: m.sellers_status_pending_review,
		variant: "outline",
		className:
			"border-saffron/30 bg-saffron/10 text-saffron-deep dark:text-saffron dark:bg-saffron/20",
	},
	active: {
		label: m.sellers_status_active,
		variant: "outline",
		className:
			"border-olive/30 bg-olive/10 text-olive dark:text-olive dark:bg-olive/20",
	},
	rejected: {
		label: m.sellers_status_rejected,
		variant: "destructive",
	},
};

export function OnboardingStatusBadge({
	status,
	className,
}: {
	status: string;
	className?: string;
}) {
	const config = statusConfig[status as OnboardingStatus];

	if (!config) {
		return (
			<Badge variant="outline" className={className}>
				{status}
			</Badge>
		);
	}

	return (
		<Badge variant={config.variant} className={cn(config.className, className)}>
			{config.label()}
		</Badge>
	);
}
