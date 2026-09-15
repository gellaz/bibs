import { toYMD } from "@bibs/ui/lib/date";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/discovery/use-geolocation";
import { api } from "@/lib/api";
import type { OpenStatusView } from "./open-status";

export interface StorePinView {
	id: string;
	name: string;
	lat: number;
	lng: number;
	category: { id: string; name: string } | null;
	city: string;
	province: string;
	/** metri, o null senza posizione utente */
	distance: number | null;
	imageUrl: string | null;
	openStatus: OpenStatusView;
}

interface UseStoreMapArgs {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	coords: Coords | null;
	radius?: number;
	openNow?: boolean;
	/** I pin si scaricano solo quando l'utente chiede la mappa. */
	enabled: boolean;
}

/**
 * I pin della vista mappa: gli stessi filtri della lista, in una richiesta
 * sola. `total` è il numero che la lista mostra; `mappable` quanti di quelli
 * hanno una posizione. La differenza va detta all'utente, non nascosta.
 */
export function useStoreMap({
	q,
	categoryId,
	macroCategoryId,
	coords,
	radius,
	openNow,
	enabled,
}: UseStoreMapArgs) {
	const query = useQuery({
		queryKey: [
			"store-map",
			q ?? "",
			categoryId ?? "",
			macroCategoryId ?? "",
			coords?.lat ?? null,
			coords?.lng ?? null,
			radius ?? null,
			openNow ?? false,
		],
		enabled,
		staleTime: 60_000,
		// Smontare una `MapContainer` costa più che smontare una griglia di card
		// (tile riscaricati, zoom/pan persi): senza `placeholderData` ogni cambio
		// filtro riporta la query in `pending` e smonta Leaflet. Tenendo i dati
		// precedenti la mappa resta viva, e `FitToPins` (che ha bisogno di una
		// mappa già montata) può riadattare l'inquadratura ai nuovi pin appena
		// arrivano.
		placeholderData: keepPreviousData,
		queryFn: async () => {
			const { data, error } = await api().customer.stores.map.get({
				query: {
					...(q ? { q } : {}),
					...(categoryId ? { categoryId } : {}),
					...(macroCategoryId ? { macroCategoryId } : {}),
					...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
					...(coords && radius ? { radius } : {}),
					...(openNow ? { openNow } : {}),
				},
			});
			if (error) {
				throw new Error(`Mappa negozi non disponibile (${error.status})`);
			}
			return data.data;
		},
	});

	const pins: StorePinView[] = (query.data?.pins ?? []).map((p) => ({
		id: p.id,
		name: p.name,
		lat: p.coordinates.lat,
		lng: p.coordinates.lng,
		category: p.category,
		city: p.municipality.name,
		province: p.municipality.provinceAcronym,
		distance: p.distance,
		imageUrl: p.image?.url ?? null,
		openStatus: {
			isOpen: p.openStatus.isOpen,
			status: p.openStatus.status,
			closesAt: p.openStatus.closesAt ?? undefined,
			// Eden idrata le stringhe-data in Date: senza toYMD il confronto con
			// "oggi" in describeOpensAt confronterebbe un Date con una stringa.
			opensAt: p.openStatus.opensAt
				? {
						date: toYMD(p.openStatus.opensAt.date),
						time: p.openStatus.opensAt.time,
					}
				: undefined,
		},
	}));

	return {
		pins,
		total: query.data?.total ?? 0,
		mappable: query.data?.mappable ?? 0,
		truncated: query.data?.truncated ?? false,
		isPending: query.isPending,
		isError: query.isError,
		refetch: query.refetch,
	};
}
