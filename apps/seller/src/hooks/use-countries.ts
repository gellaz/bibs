import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";
import { m } from "@/paraglide/messages";

/**
 * Hook to fetch the list of countries from the API.
 * Data is static so it uses a long staleTime.
 */
export function useCountries() {
	return useQuery({
		queryKey: ["countries"],
		queryFn: async () => {
			const response = await api().locations.countries.get();

			return unwrap(response, m.common_countries_load_error()).data;
		},
		staleTime: 1000 * 60 * 60, // 1 hour
	});
}
