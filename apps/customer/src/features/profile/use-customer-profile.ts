import { unwrap } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

async function fetchCustomerProfile() {
	const res = await api().customer.profile.get();
	return unwrap(res, "profile").data;
}

/** Punti fedeltà + data di iscrizione. I dati anagrafici stanno in better-auth. */
export type CustomerProfile = Awaited<ReturnType<typeof fetchCustomerProfile>>;

/**
 * Profilo cliente: saldo punti e "membro da".
 *
 * `retry: false` è voluto: l'endpoint risponde 403 a chi è autenticato ma non è
 * un cliente (un admin che apre il customer in locale, per esempio). Non è un
 * errore da ritentare, ed è la ragione per cui l'intestazione degrada mostrando
 * solo nome ed email invece di un messaggio d'errore per una riga di contorno.
 */
export function useCustomerProfile() {
	return useQuery({
		queryKey: ["customer-profile"],
		queryFn: fetchCustomerProfile,
		staleTime: 60_000,
		retry: false,
	});
}
