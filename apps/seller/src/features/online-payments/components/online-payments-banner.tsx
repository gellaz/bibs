import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { cn } from "@bibs/ui/lib/utils";
import { useRouterState } from "@tanstack/react-router";
import {
	ListTodoIcon,
	type LucideIcon,
	PlugIcon,
	SearchCheckIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { useSellerSettings } from "@/hooks/use-seller-settings";
import { m } from "@/paraglide/messages";
import { useStartOnboarding } from "../hooks/use-online-payments";
import {
	type BannerStatus,
	readDismissed,
	visibleBanner,
	writeDismissed,
} from "../lib/payments-banner";

const COPY: Record<
	BannerStatus,
	{
		icon: LucideIcon;
		title: () => string;
		body: () => string;
		cta?: () => string;
	}
> = {
	none: {
		icon: PlugIcon,
		title: m.payments_banner_none_title,
		body: m.payments_banner_none_body,
		cta: m.payments_banner_none_cta,
	},
	incomplete: {
		icon: ListTodoIcon,
		title: m.payments_banner_incomplete_title,
		body: m.payments_banner_incomplete_body,
		cta: m.payments_banner_incomplete_cta,
	},
	in_review: {
		icon: SearchCheckIcon,
		title: m.payments_banner_in_review_title,
		body: m.payments_banner_in_review_body,
	},
};

/**
 * Banner dei pagamenti online in cima a ogni pagina, solo per il titolare
 * (il dipendente non riceve `onlinePayments`). Il pulsante porta dritto su
 * Stripe; senza polling: lo stato si rilegge da Vendita o al ritorno.
 */
export function OnlinePaymentsBanner() {
	const status = useSellerSettings().data?.onlinePayments?.status;
	const onSalesTab = useRouterState({
		select: (s) =>
			s.location.pathname === "/store" &&
			s.location.search.sezione === "vendita",
	});
	const [dismissed, setDismissed] = useState(readDismissed);
	const start = useStartOnboarding();

	const shown = visibleBanner({
		status,
		dismissed,
		now: Date.now(),
		onSalesTab,
	});
	if (!shown) return null;
	const copy = COPY[shown];
	const Icon = copy.icon;

	const dismiss = () => {
		const d = { status: shown, at: Date.now() };
		writeDismissed(d);
		setDismissed(d);
	};

	return (
		<div
			className={cn(
				"flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm",
				copy.cta
					? "border-warning-foreground/15 bg-warning text-warning-foreground"
					: "border-border bg-card text-muted-foreground",
			)}
		>
			<Icon aria-hidden className="size-4 shrink-0" />
			<p className="min-w-0 flex-1">
				<span className="font-semibold">{copy.title()}</span> {copy.body()}
			</p>
			{copy.cta && (
				<Button
					size="sm"
					onClick={() =>
						start.mutate(undefined, { onError: (e) => toast.error(e.message) })
					}
					disabled={start.isPending || start.isSuccess}
				>
					{start.isPending || start.isSuccess
						? m.payments_redirecting()
						: copy.cta()}
				</Button>
			)}
			<button
				type="button"
				aria-label={m.payments_banner_dismiss()}
				title={m.payments_banner_dismiss()}
				onClick={dismiss}
				className="rounded p-1 hover:bg-foreground/10 focus-visible:focus-ring"
			>
				<XIcon aria-hidden className="size-4" />
			</button>
		</div>
	);
}
