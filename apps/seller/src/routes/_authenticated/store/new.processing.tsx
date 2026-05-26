import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { toast } from "@bibs/ui/components/sonner";
import { Spinner } from "@bibs/ui/components/spinner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useActiveStore } from "@/hooks/use-active-store";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/store/new/processing")({
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
	const { setActiveStoreId } = useActiveStore();
	const [timedOut, setTimedOut] = useState(false);

	const { data } = useQuery({
		queryKey: ["checkout-status", sessionId],
		queryFn: async () => {
			const res = await api()
				.seller["checkout-sessions"]({ sessionId })
				.status.get();
			if (res.error) throw new Error(res.error.value?.message);
			return res.data?.data;
		},
		refetchInterval: (q) =>
			q.state.data?.status === "ready" || timedOut ? false : POLL_INTERVAL_MS,
		enabled: !!sessionId && !timedOut,
	});

	useEffect(() => {
		const t = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
		return () => clearTimeout(t);
	}, []);

	useEffect(() => {
		if (data?.status === "ready" && data.storeId) {
			setActiveStoreId(data.storeId);
			void qc.invalidateQueries({ queryKey: ["stores"] });
			toast.success(m["store.processing.success"]());
			void navigate({ to: "/" });
		}
	}, [data, navigate, qc, setActiveStoreId]);

	return (
		<div className="mx-auto max-w-md py-16">
			<Card>
				<CardHeader>
					<CardTitle>{m["store.processing.title"]()}</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col items-center gap-4 py-8">
					{!timedOut ? (
						<>
							<Spinner />
							<p className="text-center text-sm text-muted-foreground">
								{m["store.processing.body"]()}
							</p>
						</>
					) : (
						<p className="text-center text-sm text-muted-foreground">
							{m["store.processing.timeout"]()}
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
