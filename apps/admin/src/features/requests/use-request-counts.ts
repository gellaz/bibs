import { queryOptions } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";

/** Conteggi delle richieste in attesa: menu, schede della pagina, dashboard. */
export const requestCountsQuery = queryOptions({
	queryKey: ["admin-requests", "counts"],
	// Il numero nel menu è la notifica in-app: si aggiorna anche senza cambi di focus.
	refetchInterval: 60_000,
	queryFn: async () => {
		const response = await adminApi.requests.counts.$get();
		if (!response.ok) return null;
		return (await response.json()).data;
	},
});
