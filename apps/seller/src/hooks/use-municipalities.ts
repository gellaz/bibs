import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const municipalitiesQueryOptions = () =>
	queryOptions({
		queryKey: ["municipalities", "all"] as const,
		queryFn: async () => {
			const response = await api().locations.municipalities.all.get();
			if (response.error) throw response.error;
			return response.data.data;
		},
		staleTime: Infinity,
		gcTime: Infinity,
	});

export function useMunicipalities() {
	return useQuery(municipalitiesQueryOptions());
}
