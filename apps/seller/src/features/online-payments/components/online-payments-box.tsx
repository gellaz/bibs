import { Button } from "@bibs/ui/components/button";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { StatusBadge } from "@bibs/ui/custom/status-badge";
import { cn } from "@bibs/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { storeOrderTypesKey } from "@/features/stores/hooks/use-store-order-types";
import { useSellerSettings } from "@/hooks/use-seller-settings";
import { m } from "@/paraglide/messages";
import {
	useStartOnboarding,
	useSyncOnlinePayments,
} from "../hooks/use-online-payments";
import { STATUS_BADGE, STATUS_BODY } from "../status";

/**
 * Pagamenti online sotto lo switch «Paga e ritira»: l'unica casa dello stato
 * Stripe (prima era una card del Profilo). Rilegge ogni 10 s finché Stripe
 * non decide, e quando lo stato cambia rilegge le tipologie: lo switch si
 * sblocca senza ricaricare.
 */
export function OnlinePaymentsBox({
	storeId,
	payOn,
}: {
	storeId: string;
	payOn: boolean;
}) {
	const { data } = useSellerSettings({ pollOnlinePayments: true });
	const start = useStartOnboarding();
	const sync = useSyncOnlinePayments();
	const qc = useQueryClient();
	const status = data?.onlinePayments?.status;

	const prev = useRef(status);
	useEffect(() => {
		if (prev.current && prev.current !== status)
			void qc.invalidateQueries({ queryKey: storeOrderTypesKey(storeId) });
		prev.current = status;
	}, [status, storeId, qc]);

	if (!data?.onlinePayments || !status) return null; // dipendente o caricamento
	const badge = STATUS_BADGE[status];
	const todo = status === "none" || status === "incomplete";
	const redirecting = start.isPending || start.isSuccess;

	const onStart = () =>
		start.mutate(undefined, { onError: (e) => toast.error(e.message) });
	const onSync = () =>
		sync.mutate(undefined, { onError: (e) => toast.error(e.message) });

	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-3 rounded-md border p-3",
				todo
					? "border-warning-foreground/15 bg-warning text-warning-foreground"
					: "border-border",
			)}
		>
			{/* Sul giallo il fondo tinto al 12% non regge AA in scuro: fondo pieno. */}
			<StatusBadge
				tone={badge.tone}
				icon={badge.icon}
				className={todo ? "bg-background" : undefined}
			>
				{badge.label()}
			</StatusBadge>
			<div
				className={cn(
					"min-w-0 flex-1 space-y-0.5 text-sm",
					!todo && "text-muted-foreground",
				)}
			>
				<p>{STATUS_BODY[status]()}</p>
				{status === "enabled" && !data.onlinePayments.payoutsEnabled && (
					<p className="text-xs">{m.payments_payouts_pending()}</p>
				)}
				{/* «Non più»: l'account c'era e Stripe l'ha sospeso; mai attivato non conta. */}
				{payOn && (status === "incomplete" || status === "in_review") && (
					<p className="text-xs">
						{m.store_order_types_pay_account_disabled()}
					</p>
				)}
			</div>
			{(status === "incomplete" || status === "in_review") && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={onSync}
					disabled={sync.isPending}
				>
					{sync.isPending && <Spinner className="size-4" />}
					{m.payments_cta_refresh()}
				</Button>
			)}
			{todo && (
				<Button
					type="button"
					size="sm"
					onClick={onStart}
					disabled={redirecting}
				>
					{redirecting
						? m.payments_redirecting()
						: status === "none"
							? m.payments_cta_start()
							: m.payments_cta_continue()}
				</Button>
			)}
		</div>
	);
}
