import { StatusBadge, type StatusTone } from "@bibs/ui/custom/status-badge";
import {
	Building2Icon,
	CircleCheckIcon,
	CircleHelpIcon,
	CircleXIcon,
	IdCardIcon,
	type LucideIcon,
	MailIcon,
	SearchCheckIcon,
	UserRoundIcon,
} from "lucide-react";
import { m } from "@/paraglide/messages";

type OnboardingStatus =
	| "pending_email"
	| "pending_personal"
	| "pending_document"
	| "pending_company"
	| "pending_review"
	| "active"
	| "rejected";

// Passi del flusso fino ad «Attivo»: il passo si mostra solo finché è in corso.
const TOTAL_STEPS = 6;

// Per l'admin: il venditore che deve completare i suoi dati è «attesa», la
// revisione tocca all'admin.
const statusConfig: Record<
	OnboardingStatus,
	{ label: () => string; tone: StatusTone; icon: LucideIcon; step?: number }
> = {
	pending_email: {
		label: m.sellers_status_pending_email,
		tone: "waiting",
		icon: MailIcon,
		step: 1,
	},
	pending_personal: {
		label: m.sellers_status_pending_personal,
		tone: "waiting",
		icon: UserRoundIcon,
		step: 2,
	},
	pending_document: {
		label: m.sellers_status_pending_document,
		tone: "waiting",
		icon: IdCardIcon,
		step: 3,
	},
	pending_company: {
		label: m.sellers_status_pending_company,
		tone: "waiting",
		icon: Building2Icon,
		step: 4,
	},
	pending_review: {
		label: m.sellers_status_pending_review,
		tone: "action",
		icon: SearchCheckIcon,
		step: 5,
	},
	active: {
		label: m.sellers_status_active,
		tone: "success",
		icon: CircleCheckIcon,
	},
	rejected: {
		label: m.sellers_status_rejected,
		tone: "destructive",
		icon: CircleXIcon,
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
			<StatusBadge tone="closed" icon={CircleHelpIcon} className={className}>
				{status}
			</StatusBadge>
		);
	}

	return (
		<StatusBadge
			tone={config.tone}
			icon={config.icon}
			className={className}
			step={
				config.step
					? {
							current: config.step,
							total: TOTAL_STEPS,
							label: m.sellers_onboarding_step({
								current: config.step,
								total: TOTAL_STEPS,
							}),
						}
					: undefined
			}
		>
			{config.label()}
		</StatusBadge>
	);
}
