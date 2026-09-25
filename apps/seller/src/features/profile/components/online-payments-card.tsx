import { Badge } from "@bibs/ui/components/badge";
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
import { useSellerSettings } from "@/hooks/use-seller-settings";
import { m } from "@/paraglide/messages";
import {
	useStartOnboarding,
	useSyncOnlinePayments,
} from "../hooks/use-online-payments";

type OnlinePaymentsStatus = "none" | "incomplete" | "in_review" | "enabled";

// Paraglide genera funzioni per chiave; l'accesso con template literal
// (`m[`payments.status.${status}`]`) non tipizza su un index dinamico, quindi
// si usa una mappa esplicita chiusa sulla union letterale dello stato.
const STATUS_VARIANT: Record<OnlinePaymentsStatus, "secondary" | "outline"> = {
	none: "secondary",
	incomplete: "secondary",
	in_review: "outline",
	enabled: "outline",
};

const STATUS_LABEL: Record<OnlinePaymentsStatus, () => string> = {
	none: m["payments.status.none"],
	incomplete: m["payments.status.incomplete"],
	in_review: m["payments.status.in_review"],
	enabled: m["payments.status.enabled"],
};

const STATUS_BODY: Record<OnlinePaymentsStatus, () => string> = {
	none: m["payments.none.body"],
	incomplete: m["payments.incomplete.body"],
	in_review: m["payments.in_review.body"],
	enabled: m["payments.enabled.body"],
};

export function OnlinePaymentsCard() {
	const { data } = useSellerSettings();
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
					<CardTitle>{m["payments.title"]()}</CardTitle>
					<Badge
						variant={STATUS_VARIANT[op.status]}
						className={
							op.status === "enabled"
								? "border-olive/30 bg-olive/10 text-olive dark:bg-olive/20"
								: undefined
						}
					>
						{STATUS_LABEL[op.status]()}
					</Badge>
				</div>
				<CardDescription>{m["payments.description"]()}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				<p>{STATUS_BODY[op.status]()}</p>
				{op.status === "enabled" && !op.payoutsEnabled && (
					<p className="text-muted-foreground">
						{m["payments.payouts.pending"]()}
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					{op.status === "none" && (
						<Button
							onClick={onStart}
							disabled={start.isPending || start.isSuccess}
						>
							{start.isPending || start.isSuccess
								? m["payments.redirecting"]()
								: m["payments.cta.start"]()}
						</Button>
					)}
					{(op.status === "incomplete" || op.status === "in_review") && (
						<Button
							onClick={onStart}
							disabled={start.isPending || start.isSuccess}
						>
							{start.isPending || start.isSuccess
								? m["payments.redirecting"]()
								: m["payments.cta.continue"]()}
						</Button>
					)}
					{op.status !== "none" && op.status !== "enabled" && (
						<Button
							variant="outline"
							onClick={onSync}
							disabled={sync.isPending}
						>
							{sync.isPending && <Spinner className="size-4" />}
							{m["payments.cta.refresh"]()}
						</Button>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
