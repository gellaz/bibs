import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Conteggi delle richieste in attesa: menu, schede della pagina, dashboard. */
export const requestCountsQuery = queryOptions({
	queryKey: ["admin-requests", "counts"],
	queryFn: async () => {
		const response = await api().admin.requests.counts.get();
		if (response.error) return null;
		return response.data?.data ?? null;
	},
});
