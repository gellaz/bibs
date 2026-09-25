import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useSyncOnlinePayments } from "@/features/profile/hooks/use-online-payments";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/payments/return")({
	component: PaymentsReturnPage,
});

// Stripe rimanda qui a fine onboarding senza dire com'è andata: si rilegge il
// conto (il webhook può non essere ancora arrivato) e si torna al profilo.
function PaymentsReturnPage() {
	const navigate = useNavigate();
	const sync = useSyncOnlinePayments();
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		sync.mutate(undefined, {
			onError: (e) => toast.error(e.message),
			onSettled: () => void navigate({ to: "/profile", replace: true }),
		});
	}, [sync, navigate]);

	return (
		<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
			<Spinner className="size-8" />
			{m["payments.return.checking"]()}
		</div>
	);
}
