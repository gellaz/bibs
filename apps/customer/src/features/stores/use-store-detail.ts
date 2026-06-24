import { toYMD } from "@bibs/ui/lib/date";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { OpeningHoursDayInput } from "./format-opening-hours";
import type { OpenStatusView } from "./open-status";

export interface StoreDetailView {
	id: string;
	name: string;
	description: string | null;
	category: { id: string; name: string } | null;
	city: string;
	province: string;
	addressLine1: string;
	addressLine2: string | null;
	zipCode: string;
	coordinates: { lat: number; lng: number } | null;
	images: { id: string; url: string }[];
	phoneNumbers: { id: string; label: string | null; number: string }[];
	websiteUrl: string | null;
	openingHours: OpeningHoursDayInput[] | null;
	openStatus: OpenStatusView;
}

/** Fetches a store's public detail. Returns `null` (not an error) on 404. */
export function useStoreDetail(storeId: string) {
	return useQuery({
		queryKey: ["store-detail", storeId],
		staleTime: 60_000,
		queryFn: async (): Promise<StoreDetailView | null> => {
			const { data, error } = await api()
				.customer.stores({ id: storeId })
				.get();
			if (error) {
				if (error.status === 404) return null;
				throw new Error(`Caricamento negozio non riuscito (${error.status})`);
			}
			const s = data.data;
			return {
				id: s.id,
				name: s.name,
				description: s.description,
				category: s.category,
				city: s.municipality.name,
				province: s.municipality.provinceAcronym,
				addressLine1: s.addressLine1,
				addressLine2: s.addressLine2,
				zipCode: s.zipCode,
				coordinates: s.coordinates,
				images: s.images.map((i) => ({ id: i.id, url: i.url })),
				phoneNumbers: s.phoneNumbers.map((p) => ({
					id: p.id,
					label: p.label,
					number: p.number,
				})),
				websiteUrl: s.websiteUrl,
				openingHours: s.openingHours,
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
			};
		},
	});
}
