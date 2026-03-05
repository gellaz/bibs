import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Hook to fetch the list of countries from the API.
 * Data is static so it uses a long staleTime.
 */
export function useCountries() {
	return useQuery({
		queryKey: ["countries"],
		queryFn: async () => {
			const response = await api().locations.countries.get();

			if (response.error) {
				throw new Error(
					typeof response.error.value === "string"
						? response.error.value
						: "Errore nel caricamento dei paesi",
				);
			}

			return response.data.data;
		},
		staleTime: 1000 * 60 * 60, // 1 hour
	});
}
