import { Alert, AlertDescription, AlertTitle } from "@bibs/ui/components/alert";
import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { intlLocale } from "@bibs/ui/lib/intl-locale";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, CalendarIcon, LockIcon } from "lucide-react";
import { type Subscription, useActiveStore } from "@/hooks/use-active-store";
import { api, unwrap } from "@/lib/api";
import { richMessage } from "@/lib/rich-message";
import { m } from "@/paraglide/messages";

export function StoreBillingBanner() {
	const { activeStore, activeSubscription } = useActiveStore();
	const qc = useQueryClient();

	const portalMutation = useMutation({
		mutationFn: async () => {
			const r = await api().seller.billing.portal.post();
			return unwrap(r, m.common_error()).data;
		},
		onSuccess: (data) => {
			if (data?.url) window.location.href = data.url;
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const reactivateMutation = useMutation({
		mutationFn: async () => {
			if (!activeStore) throw new Error(m.store_no_active());
			const r = await api()
				.seller.stores({ storeId: activeStore.id })
				.reactivate.post();
			return unwrap(r, m.common_error()).data;
		},
		onSuccess: () => {
			// Optimistically flip the local subscription cache to 'active' so the banner
			// disappears immediately. The DB is updated by Stripe's customer.subscription.updated
			// webhook (~100-500ms later); a delayed refetch reconciles the cache with the
			// authoritative DB state once the webhook lands.
			if (activeStore) {
				qc.setQueryData<Subscription[] | undefined>(
					["seller", "billing", "subscriptions"],
					(old) =>
						old?.map((s) =>
							s.storeId === activeStore.id
								? { ...s, status: "active", cancelAtPeriodEnd: false }
								: s,
						),
				);
			}
			setTimeout(() => {
				void qc.invalidateQueries({ queryKey: ["seller", "billing"] });
			}, 1500);
			toast.success(m.billing_cancel_undone());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (!activeStore || !activeSubscription) return null;

	const formattedDate = new Intl.DateTimeFormat(intlLocale(), {
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(new Date(activeSubscription.currentPeriodEnd));

	if (activeSubscription.status === "past_due") {
		return (
			<Alert variant="destructive">
				<AlertTriangleIcon className="h-4 w-4" />
				<AlertTitle>
					{m.billing_banner_past_due_title({ store: activeStore.name })}
				</AlertTitle>
				<AlertDescription className="flex flex-col gap-3">
					<span>
						{richMessage(
							m.billing_banner_past_due_description({ date: "{date}" }),
							{ date: <strong>{formattedDate}</strong> },
						)}
					</span>
					<div>
						<Button
							size="sm"
							onClick={() => portalMutation.mutate()}
							disabled={portalMutation.isPending}
						>
							{m.billing_banner_update_payment()}
						</Button>
					</div>
				</AlertDescription>
			</Alert>
		);
	}

	if (activeSubscription.status === "canceling") {
		return (
			<Alert>
				<CalendarIcon className="h-4 w-4" />
				<AlertTitle>
					{m.billing_banner_canceling_title({ store: activeStore.name })}
				</AlertTitle>
				<AlertDescription className="flex flex-col gap-3">
					<span>
						{richMessage(
							m.billing_banner_canceling_description({ date: "{date}" }),
							{ date: <strong>{formattedDate}</strong> },
						)}
					</span>
					<div>
						<Button
							size="sm"
							variant="outline"
							onClick={() => reactivateMutation.mutate()}
							disabled={reactivateMutation.isPending}
						>
							{m.billing_undo_cancel()}
						</Button>
					</div>
				</AlertDescription>
			</Alert>
		);
	}

	if (activeSubscription.status === "suspended") {
		return (
			<Alert variant="destructive">
				<LockIcon className="h-4 w-4" />
				<AlertTitle>
					{m.billing_banner_suspended_title({ store: activeStore.name })}
				</AlertTitle>
				<AlertDescription className="flex flex-col gap-3">
					<span>{m.billing_banner_suspended_description()}</span>
					<div>
						<Button
							size="sm"
							onClick={() => portalMutation.mutate()}
							disabled={portalMutation.isPending}
						>
							{m.billing_banner_reactivate_now()}
						</Button>
					</div>
				</AlertDescription>
			</Alert>
		);
	}

	return null;
}
