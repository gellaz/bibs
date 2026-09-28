import { unwrap } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const POINTS_KEY = ["customer", "points"] as const;
export const POINTS_PAGE_SIZE = 20;

/** Saldo e movimenti punti, una pagina alla volta (più recenti prima). */
export function useCustomerPoints(page: number) {
	return useQuery({
		queryKey: [...POINTS_KEY, page],
		queryFn: async () =>
			unwrap(
				await api().customer.points.get({
					query: { page, limit: POINTS_PAGE_SIZE },
				}),
				m.points_load_failed(),
			).data,
	});
}
