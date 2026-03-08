import { Badge } from "@bibs/ui/components/badge";
import { cn } from "@bibs/ui/lib/utils";

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
		label: string;
		variant: "secondary" | "destructive" | "outline";
		className?: string;
	}
> = {
	pending_email: {
		label: "In attesa di verifica email",
		variant: "secondary",
	},
	pending_personal: {
		label: "Dati anagrafici mancanti",
		variant: "secondary",
	},
	pending_document: {
		label: "Documento mancante",
		variant: "secondary",
	},
	pending_company: {
		label: "Dati aziendali mancanti",
		variant: "secondary",
	},
	pending_store: {
		label: "Negozio mancante",
		variant: "secondary",
	},
	pending_payment: {
		label: "Pagamento mancante",
		variant: "secondary",
	},
	pending_review: {
		label: "In attesa di revisione",
		variant: "outline",
		className:
			"border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 dark:bg-amber-500/20",
	},
	active: {
		label: "Attivo",
		variant: "outline",
		className:
			"border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 dark:bg-emerald-500/20",
	},
	rejected: {
		label: "Rifiutato",
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
			{config.label}
		</Badge>
	);
}
