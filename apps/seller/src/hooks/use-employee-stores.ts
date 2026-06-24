// apps/seller/src/hooks/use-employee-stores.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api";

/**
 * Fetches the stores assigned to a given employee. Owner-only endpoint server-side.
 * Disabled when employeeId is null.
 */
export function useEmployeeStores(employeeId: string | null) {
	return useQuery({
		queryKey: ["employees", employeeId, "stores"],
		queryFn: async () => {
			if (!employeeId) return [];
			const response = await api()
				.seller.employees({ employeeId })
				.stores.get();
			return unwrap(response, "Errore nel caricamento negozi assegnati").data;
		},
		enabled: employeeId !== null,
	});
}

/**
 * Mutation to replace the set of stores assigned to an employee (idempotent PUT).
 * Invalidates the employees queryKey on success.
 */
export function useUpdateEmployeeStores(employeeId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (storeIds: string[]) => {
			const response = await api()
				.seller.employees({ employeeId })
				.stores.put({ storeIds });
			return unwrap(response, "Errore nell'aggiornamento assegnazioni").data;
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["employees"] });
		},
	});
}
