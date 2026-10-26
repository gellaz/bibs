import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { customerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const POINTS_KEY = ["customer", "points"] as const;
export const POINTS_PAGE_SIZE = 20;

/** Saldo e movimenti punti, una pagina alla volta (più recenti prima). */
export function useCustomerPoints(page: number) {
	return useQuery({
		queryKey: [...POINTS_KEY, page],
		queryFn: async () =>
			(
				await unwrapJson(
					await customerApi.points.$get({
						query: { page, limit: POINTS_PAGE_SIZE },
					}),
					m.points_load_failed(),
				)
			).data,
	});
}
