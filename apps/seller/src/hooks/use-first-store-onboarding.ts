import { useQuery } from "@tanstack/react-query";
import { useActiveStore } from "@/hooks/use-active-store";
import { api } from "@/lib/api";

/**
 * True quando il seller non ha MAI avuto un negozio: zero attivi e zero
 * archiviati. È lo stato "primo negozio" — il layout nasconde sidebar/header
 * e /store/new si veste da step finale dell'onboarding.
 *
 * Un seller che ha cancellato l'unico negozio (solo archiviati) NON è un
 * first-timer: mantiene il layout completo, con Archivio e Billing
 * raggiungibili, e l'empty state della home.
 *
 * La query sugli archiviati parte solo quando gli attivi sono zero: sul
 * percorso comune (seller con negozi) non costa nulla.
 */
export function useFirstStoreOnboarding() {
	const { stores, isLoading: storesLoading } = useActiveStore();
	const noActiveStores = !storesLoading && stores.length === 0;

	const { data: archived, isLoading: archivedLoading } = useQuery({
		queryKey: ["seller", "stores", "archived"],
		queryFn: async () => {
			const r = await api().seller.stores.archived.get({
				query: { page: 1, limit: 50 },
			});
			if (r.error) throw new Error(r.error.value?.message);
			return r.data?.data;
		},
		enabled: noActiveStores,
	});

	return {
		isLoading: storesLoading || (noActiveStores && archivedLoading),
		isFirstStore:
			noActiveStores && !archivedLoading && (archived?.data ?? []).length === 0,
	};
}
