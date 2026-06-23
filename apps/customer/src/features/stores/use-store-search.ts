import { useInfiniteQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/discovery/use-geolocation";
import { api } from "@/lib/api";
import { toYMD } from "@/lib/date";

export interface StoreCardView {
	id: string;
	name: string;
	category: { id: string; name: string } | null;
	city: string;
	province: string;
	addressLine1: string;
	/** meters, or null when no geo / store has no location */
	distance: number | null;
	imageUrl: string | null;
	openStatus: {
		isOpen: boolean;
		status: "open" | "closed" | "closed_holiday";
		closesAt?: string;
		opensAt?: { date: string; time: string };
	};
}

interface UseStoreSearchArgs {
	q?: string;
	categoryId?: string;
	coords: Coords | null;
	limit?: number;
}

export function useStoreSearch({
	q,
	categoryId,
	coords,
	limit = 20,
}: UseStoreSearchArgs) {
	const query = useInfiniteQuery({
		queryKey: [
			"store-search",
			q ?? "",
			categoryId ?? "",
			coords?.lat ?? null,
			coords?.lng ?? null,
			limit,
		],
		staleTime: 60_000,
		initialPageParam: 1,
		queryFn: async ({ pageParam }) => {
			const { data, error } = await api().customer.stores.get({
				query: {
					page: pageParam,
					limit,
					...(q ? { q } : {}),
					...(categoryId ? { categoryId } : {}),
					...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
				},
			});
			if (error) {
				throw new Error(`Ricerca negozi non riuscita (${error.status})`);
			}
			return data;
		},
		getNextPageParam: (lastPage) => {
			const { page, limit: lim, total } = lastPage.pagination;
			return page * lim < total ? page + 1 : undefined;
		},
	});

	const stores: StoreCardView[] =
		query.data?.pages.flatMap((p) =>
			p.data.map((s) => ({
				id: s.id,
				name: s.name,
				category: s.category,
				city: s.municipality.name,
				province: s.municipality.provinceAcronym,
				addressLine1: s.addressLine1,
				distance: s.distance,
				imageUrl: s.image?.url ?? null,
				openStatus: {
					isOpen: s.openStatus.isOpen,
					status: s.openStatus.status,
					closesAt: s.openStatus.closesAt ?? undefined,
					opensAt: s.openStatus.opensAt
						? {
								date: toYMD(s.openStatus.opensAt.date),
								time: s.openStatus.opensAt.time,
							}
						: undefined,
				},
			})),
		) ?? [];

	return {
		stores,
		total: query.data?.pages[0]?.pagination.total ?? 0,
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isFetchingNextPage: query.isFetchingNextPage,
		isPending: query.isPending,
		isError: query.isError,
		refetch: query.refetch,
	};
}
