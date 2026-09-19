import { unwrap } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const ADDRESSES_KEY = ["customer", "addresses"] as const;

// Una rubrica personale non arriva a 50 voci: una pagina sola, e il cap
// dell'API è comunque 100.
async function fetchAddresses() {
	const res = await api().customer.addresses.get({ query: { limit: 50 } });
	return unwrap(res, m.addresses_load_failed()).data;
}

// I tipi vengono dall'API via Eden: nessun DTO scritto a mano da tenere in sync.
export type AddressItem = Awaited<ReturnType<typeof fetchAddresses>>[number];

export function useAddresses() {
	return useQuery({
		queryKey: ADDRESSES_KEY,
		staleTime: 60_000,
		queryFn: fetchAddresses,
	});
}
