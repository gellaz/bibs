import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { customerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const ADDRESSES_KEY = ["customer", "addresses"] as const;

// Una rubrica personale non arriva a 50 voci: una pagina sola, e il cap
// dell'API è comunque 100.
async function fetchAddresses() {
	const res = await customerApi.addresses.$get({ query: { limit: 50 } });
	return (await unwrapJson(res, m.addresses_load_failed())).data;
}

// I tipi vengono dall'API via `hc`: nessun DTO scritto a mano da tenere in sync.
export type AddressItem = Awaited<ReturnType<typeof fetchAddresses>>[number];

/**
 * `retry: false` è voluto: l'endpoint risponde 403 a chi è autenticato ma non è
 * un cliente, e ritentare tre volte non aiuta (stessa ragione di
 * `useCustomerProfile`).
 */
export function useAddresses() {
	return useQuery({
		queryKey: ADDRESSES_KEY,
		staleTime: 60_000,
		queryFn: fetchAddresses,
		retry: false,
	});
}
