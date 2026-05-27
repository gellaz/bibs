import { Alert, AlertDescription, AlertTitle } from "@bibs/ui/components/alert";
import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, CalendarIcon, LockIcon } from "lucide-react";
import { type Subscription, useActiveStore } from "@/hooks/use-active-store";
import { api } from "@/lib/api";

export function StoreBillingBanner() {
	const { activeStore, activeSubscription } = useActiveStore();
	const qc = useQueryClient();

	const portalMutation = useMutation({
		mutationFn: async () => {
			const r = await api().seller.billing.portal.post();
			if (r.error) throw new Error((r.error.value as any)?.message);
			return r.data?.data;
		},
		onSuccess: (data) => {
			if (data?.url) window.location.href = data.url;
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const reactivateMutation = useMutation({
		mutationFn: async () => {
			if (!activeStore) throw new Error("Nessun negozio selezionato");
			const r = await api()
				.seller.stores({ storeId: activeStore.id })
				.reactivate.post();
			if (r.error) throw new Error((r.error.value as any)?.message);
			return r.data?.data;
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
			toast.success("Cancellazione annullata");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (!activeStore || !activeSubscription) return null;

	const formattedDate = new Intl.DateTimeFormat("it-IT", {
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(new Date(activeSubscription.currentPeriodEnd));

	if (activeSubscription.status === "past_due") {
		return (
			<Alert variant="destructive">
				<AlertTriangleIcon className="h-4 w-4" />
				<AlertTitle>Rinnovo non riuscito per {activeStore.name}</AlertTitle>
				<AlertDescription className="flex flex-col gap-3">
					<span>
						Aggiorna il metodo di pagamento entro il{" "}
						<strong>{formattedDate}</strong> o il negozio sarà sospeso.
					</span>
					<div>
						<Button
							size="sm"
							onClick={() => portalMutation.mutate()}
							disabled={portalMutation.isPending}
						>
							Aggiorna pagamento
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
				<AlertTitle>{activeStore.name}: cancellazione programmata</AlertTitle>
				<AlertDescription className="flex flex-col gap-3">
					<span>
						Il negozio sarà disattivato il <strong>{formattedDate}</strong>.
						Fino ad allora rimane attivo e visibile ai clienti.
					</span>
					<div>
						<Button
							size="sm"
							variant="outline"
							onClick={() => reactivateMutation.mutate()}
							disabled={reactivateMutation.isPending}
						>
							Annulla cancellazione
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
				<AlertTitle>{activeStore.name} è sospeso</AlertTitle>
				<AlertDescription className="flex flex-col gap-3">
					<span>
						Non è visibile ai clienti. Paga il rinnovo per riattivarlo.
					</span>
					<div>
						<Button
							size="sm"
							onClick={() => portalMutation.mutate()}
							disabled={portalMutation.isPending}
						>
							Riattiva ora
						</Button>
					</div>
				</AlertDescription>
			</Alert>
		);
	}

	return null;
}
