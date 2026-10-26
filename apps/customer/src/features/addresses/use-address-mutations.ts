import { toast } from "@bibs/ui/components/sonner";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customerApi } from "@/lib/api";
import { m } from "@/paraglide/messages";
import type { addressFormToBody } from "./address-form-state";
import { ADDRESSES_KEY } from "./use-addresses";

type AddressBody = ReturnType<typeof addressFormToBody>;

/**
 * Tutte le scritture sulla rubrica. Dopo ognuna si invalida la lista e si
 * rilegge: nessuno stato locale che duplichi il server.
 */
export function useAddressMutations() {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: ADDRESSES_KEY });

	const create = useMutation({
		mutationFn: async (body: AddressBody) => {
			const res = await customerApi.addresses.$post({ json: body });
			return (await unwrapJson(res, m.error_generic())).data;
		},
		onSuccess: () => {
			void invalidate();
			toast.success(m.addresses_saved());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const update = useMutation({
		mutationFn: async (vars: { addressId: string; body: AddressBody }) => {
			const res = await customerApi.addresses[":addressId"].$patch({
				param: { addressId: vars.addressId },
				json: vars.body,
			});
			return (await unwrapJson(res, m.error_generic())).data;
		},
		onSuccess: () => {
			void invalidate();
			toast.success(m.addresses_saved());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const remove = useMutation({
		mutationFn: async (addressId: string) => {
			const res = await customerApi.addresses[":addressId"].$delete({
				param: { addressId },
			});
			return unwrapJson(res, m.error_generic());
		},
		onSuccess: () => {
			void invalidate();
			toast.success(m.addresses_deleted());
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return { create, update, remove };
}
