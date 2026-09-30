import { Spinner } from "@bibs/ui/components/spinner";
import { toYMD } from "@bibs/ui/lib/date";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
	ClosuresManager,
	type ClosuresState,
} from "@/features/stores/components/closures-manager";
import { useActiveStore } from "@/hooks/use-active-store";
import { useIsOwner } from "@/hooks/use-is-owner";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/store/closures")({
	component: ClosuresPage,
});

function ClosuresPage() {
	const { activeStore } = useActiveStore();
	const storeId = activeStore?.id;
	const navigate = useNavigate();
	const isOwner = useIsOwner();

	// Closures are owner-only (the API enforces requireOwner). Employees who
	// deep-link here are redirected home; the query stays disabled so it never
	// fires a request that would 403.
	useEffect(() => {
		if (!isOwner) void navigate({ to: "/" });
	}, [isOwner, navigate]);

	const { data, isLoading, error } = useQuery({
		queryKey: ["store-closures", storeId],
		queryFn: async (): Promise<ClosuresState> => {
			if (!storeId) throw new Error("No active store");
			const response = await api().seller.stores({ storeId }).closures.get();
			const data = unwrap(response, m["store.closures.error"]());
			// Eden rehydrates date-string fields into Date objects; normalise them
			// back to "YYYY-MM-DD" so the manager (render, dirty-tracking, PUT body)
			// works with strings as typed.
			const raw = data.data as ClosuresState;
			return {
				holidays: raw.holidays.map((h) => ({
					...h,
					nextDate: h.nextDate ? toYMD(h.nextDate) : null,
				})),
				customClosures: raw.customClosures.map((c) => ({
					startDate: toYMD(c.startDate),
					endDate: c.endDate ? toYMD(c.endDate) : undefined,
					note: c.note,
				})),
			};
		},
		enabled: !!storeId && isOwner,
	});

	return (
		<div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
			<header className="space-y-1.5">
				<h1 className="font-display text-2xl font-semibold tracking-tight">
					{m["store.closures.title"]()}
				</h1>
				<p className="text-muted-foreground">
					{m["store.closures.subtitle"]()}
				</p>
			</header>

			{!activeStore ? (
				<p className="text-muted-foreground">
					{m["store.closures.no_store"]()}
				</p>
			) : error ? (
				<div className="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-4">
					<p className="text-sm">{(error as Error).message}</p>
				</div>
			) : isLoading || !data ? (
				<div className="flex justify-center py-12">
					<Spinner />
				</div>
			) : (
				<ClosuresManager
					key={storeId}
					storeId={storeId as string}
					initial={data}
				/>
			)}
		</div>
	);
}
