import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { StatusBadge, type StatusTone } from "@bibs/ui/custom/status-badge";
import {
	CircleCheckIcon,
	ListTodoIcon,
	type LucideIcon,
	PlugIcon,
	SearchCheckIcon,
} from "lucide-react";
import { useSellerSettings } from "@/hooks/use-seller-settings";
import { m } from "@/paraglide/messages";
import {
	useStartOnboarding,
	useSyncOnlinePayments,
} from "../hooks/use-online-payments";

type OnlinePaymentsStatus = "none" | "incomplete" | "in_review" | "enabled";

// Paraglide genera funzioni per chiave; l'accesso con template literal
// (`m[`payments_status_${status}`]`) non tipizza su un index dinamico, quindi
// si usa una mappa esplicita chiusa sulla union letterale dello stato.
// Toni per il venditore: attivare e completare toccano a lui, la verifica a Stripe.
const STATUS_BADGE: Record<
	OnlinePaymentsStatus,
	{ tone: StatusTone; icon: LucideIcon }
> = {
	none: { tone: "action", icon: PlugIcon },
	incomplete: { tone: "action", icon: ListTodoIcon },
	in_review: { tone: "waiting", icon: SearchCheckIcon },
	enabled: { tone: "success", icon: CircleCheckIcon },
};

const STATUS_LABEL: Record<OnlinePaymentsStatus, () => string> = {
	none: m.payments_status_none,
	incomplete: m.payments_status_incomplete,
	in_review: m.payments_status_in_review,
	enabled: m.payments_status_enabled,
};

const STATUS_BODY: Record<OnlinePaymentsStatus, () => string> = {
	none: m.payments_none_body,
	incomplete: m.payments_incomplete_body,
	in_review: m.payments_in_review_body,
	enabled: m.payments_enabled_body,
};

export function OnlinePaymentsCard() {
	const { data } = useSellerSettings({ pollOnlinePayments: true });
	const start = useStartOnboarding();
	const sync = useSyncOnlinePayments();
	const op = data?.onlinePayments;
	if (!op) return null; // employee o caricamento

	const onStart = () =>
		start.mutate(undefined, { onError: (e) => toast.error(e.message) });
	const onSync = () =>
		sync.mutate(undefined, { onError: (e) => toast.error(e.message) });

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-3">
					<CardTitle>{m.payments_title()}</CardTitle>
					<StatusBadge
						tone={STATUS_BADGE[op.status].tone}
						icon={STATUS_BADGE[op.status].icon}
					>
						{STATUS_LABEL[op.status]()}
					</StatusBadge>
				</div>
				<CardDescription>{m.payments_description()}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				<p>{STATUS_BODY[op.status]()}</p>
				{op.status === "enabled" && !op.payoutsEnabled && (
					<p className="text-muted-foreground">
						{m.payments_payouts_pending()}
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					{op.status === "none" && (
						<Button
							onClick={onStart}
							disabled={start.isPending || start.isSuccess}
						>
							{start.isPending || start.isSuccess
								? m.payments_redirecting()
								: m.payments_cta_start()}
						</Button>
					)}
					{(op.status === "incomplete" || op.status === "in_review") && (
						<Button
							onClick={onStart}
							disabled={start.isPending || start.isSuccess}
						>
							{start.isPending || start.isSuccess
								? m.payments_redirecting()
								: m.payments_cta_continue()}
						</Button>
					)}
					{op.status !== "none" && op.status !== "enabled" && (
						<Button
							variant="outline"
							onClick={onSync}
							disabled={sync.isPending}
						>
							{sync.isPending && <Spinner className="size-4" />}
							{m.payments_cta_refresh()}
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
