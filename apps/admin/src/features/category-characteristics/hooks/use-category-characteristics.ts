import { toast } from "@bibs/ui/components/sonner";
import { unwrapJson } from "@bibs/ui/lib/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api";
import { m } from "@/paraglide/messages";

export function categoryCharacteristicsKey(categoryId: string) {
	return ["admin-category-characteristics", categoryId] as const;
}

export function useCategoryCharacteristics(categoryId: string) {
	const queryClient = useQueryClient();
	const characteristics =
		adminApi["product-categories"][":productCategoryId"].characteristics;

	const { data, isLoading, error } = useQuery({
		queryKey: categoryCharacteristicsKey(categoryId),
		queryFn: async () => {
			const res = await characteristics.$get({
				param: { productCategoryId: categoryId },
			});
			return (await unwrapJson(res, m.characteristics_load_error())).data;
		},
	});

	// Il pannello, la pastiglia nella tabella delle sotto-categorie (che mostra
	// il conteggio) e la tabella del dizionario (che mostra il valueCount per
	// caratteristica/opzione) leggono da tre query diverse: si aggiornano tutte.
	const refresh = () => {
		void queryClient.invalidateQueries({
			queryKey: categoryCharacteristicsKey(categoryId),
		});
		void queryClient.invalidateQueries({ queryKey: ["product-categories"] });
		void queryClient.invalidateQueries({
			queryKey: ["product-characteristics"],
		});
	};

	const include = useMutation({
		mutationFn: async (p: { characteristicId: string; required: boolean }) => {
			const res = await characteristics[":characteristicId"].$put({
				param: {
					productCategoryId: categoryId,
					characteristicId: p.characteristicId,
				},
				json: { required: p.required },
			});
			await unwrapJson(res, m.common_save_error());
		},
		onSuccess: refresh,
		onError: (e: Error) => toast.error(e.message),
	});

	const remove = useMutation({
		mutationFn: async (p: {
			characteristicId: string;
			confirmAffected: number;
		}) => {
			const res = await characteristics[":characteristicId"].$delete({
				param: {
					productCategoryId: categoryId,
					characteristicId: p.characteristicId,
				},
				json: { confirmAffected: p.confirmAffected },
			});
			await unwrapJson(res, m.common_remove_error());
		},
		onSuccess: refresh,
		// Anche sull'errore: un 409 per conteggio vecchio deve portare in pagina
		// il numero nuovo prima che l'admin riprovi.
		onError: (e: Error) => {
			refresh();
			toast.error(e.message);
		},
	});

	return {
		rows: data ?? [],
		isLoading,
		error: error as Error | null,
		include,
		remove,
		isMutating: include.isPending || remove.isPending,
	};
}
