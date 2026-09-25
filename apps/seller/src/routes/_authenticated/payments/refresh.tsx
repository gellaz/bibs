import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useStartOnboarding } from "@/features/profile/hooks/use-online-payments";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/payments/refresh")({
	component: PaymentsRefreshPage,
});

// Stripe rimanda qui quando il link di onboarding è scaduto o non valido: se
// ne crea uno nuovo e si riparte subito verso Stripe.
function PaymentsRefreshPage() {
	const navigate = useNavigate();
	const start = useStartOnboarding();
	const started = useRef(false);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		start.mutate(undefined, {
			onError: (e) => {
				toast.error(e.message);
				void navigate({ to: "/profile", replace: true });
			},
		});
	}, [start, navigate]);

	return (
		<div className="flex h-64 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
			<Spinner className="size-8" />
			{m["payments.redirecting"]()}
		</div>
	);
}
