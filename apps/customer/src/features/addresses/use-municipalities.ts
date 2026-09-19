import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Elenco completo dei comuni italiani, servito dall'API con cache HTTP di 24h e
 * immutabile: `staleTime: Infinity`. Serve al fallback sul comune quando il
 * geocoder non lo risolve.
 *
 * È il gemello dell'hook del seller (`apps/seller/src/hooks/use-municipalities.ts`):
 * duplicato di proposito, perché i register non condividono codice applicativo.
 */
export function useMunicipalities() {
	return useQuery({
		queryKey: ["municipalities", "all"] as const,
		queryFn: async () => {
			const res = await api().locations.municipalities.all.get();
			if (res.error) throw res.error;
			return res.data.data;
		},
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});
}
