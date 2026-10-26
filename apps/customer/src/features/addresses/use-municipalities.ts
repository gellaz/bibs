import type { MunicipalityComboboxLabels } from "@bibs/ui/custom/municipality-combobox";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { locationsApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

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
			const res = await locationsApi.municipalities.all.$get();
			return (await unwrapJson(res, m.municipality_combobox_error())).data;
		},
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});
}
