import { toast } from "@bibs/ui/components/sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckoutProcessingCard } from "@/features/stores/components/checkout-processing-card";
import {
	checkoutProgress,
	finishCheckout,
} from "@/features/stores/lib/checkout-progress";
import { useActiveStore } from "@/hooks/use-active-store";
import { useIsOwner } from "@/hooks/use-is-owner";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

// `new_`: stesso URL /store/new/processing (la success_url di Stripe), ma fuori
// dal layout di `store/new`, che è il form e non rende un <Outlet />.
export const Route = createFileRoute("/_authenticated/store/new_/processing")({
	validateSearch: (search) =>
		({
			session_id:
				typeof search.session_id === "string" ? search.session_id : "",
		}) as { session_id: string },
	component: ProcessingPage,
});

const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MS = 60_000;

function ProcessingPage() {
	const { session_id: sessionId } = Route.useSearch();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const isOwner = useIsOwner();
	const { setActiveStoreId } = useActiveStore();
	const [timedOut, setTimedOut] = useState(false);
	const finished = useRef(false);

	// Solo il titolare crea negozi (l'API risponde 403 al dipendente): stesso
	// guard client-side di /store/new.
	useEffect(() => {
		if (!isOwner) void navigate({ to: "/store" });
	}, [isOwner, navigate]);

	const { data, error } = useQuery({
		queryKey: ["checkout-status", sessionId],
		queryFn: async () => {
			const res = await api()
				.seller["checkout-sessions"]({ sessionId })
				.status.get();
			return unwrap(res, m.common_error()).data;
		},
		refetchInterval: (q) =>
			checkoutProgress({
				sessionId,
				status: q.state.data?.status,
				storeId: q.state.data?.storeId,
				error: q.state.error,
				timedOut,
			}).kind === "waiting"
				? POLL_INTERVAL_MS
				: false,
		enabled: isOwner && !!sessionId && !timedOut,
	});

	const progress = checkoutProgress({
		sessionId,
		status: data?.status,
		storeId: data?.storeId,
		error,
		timedOut,
	});

	// «Controlla di nuovo» rimette timedOut a false e riarma il timeout.
	useEffect(() => {
		if (timedOut) return;
		const t = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
		return () => clearTimeout(t);
	}, [timedOut]);

	const readyStoreId = progress.kind === "ready" ? progress.storeId : null;
	useEffect(() => {
		if (!readyStoreId || finished.current) return;
		finished.current = true;
		void finishCheckout(readyStoreId, {
			refetchStores: () => qc.invalidateQueries({ queryKey: ["stores"] }),
			setActiveStoreId,
			notify: () => toast.success(m.store_processing_success()),
			goHome: () => navigate({ to: "/" }),
		});
	}, [readyStoreId, navigate, qc, setActiveStoreId]);

	if (!isOwner) return null;

	return (
		<CheckoutProcessingCard
			kind={progress.kind}
			onRetry={() => setTimedOut(false)}
			onBackToForm={() => void navigate({ to: "/store/new" })}
		/>
	);
}
