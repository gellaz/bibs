import type { MunicipalityComboboxLabels } from "@bibs/ui/custom/municipality-combobox";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

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

/** Testi di `MunicipalityCombobox` nella lingua corrente. */
export function municipalityComboboxLabels(): MunicipalityComboboxLabels {
	return {
		placeholder: m.municipality_combobox_placeholder(),
		loading: m.municipality_combobox_loading(),
		error: m.municipality_combobox_error(),
		empty: m.municipality_combobox_empty(),
		moreResults: (count) => m.municipality_combobox_more_results({ count }),
	};
}
