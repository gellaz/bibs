import { toast } from "@bibs/ui/components/sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function categoryCharacteristicsKey(categoryId: string) {
	return ["admin-category-characteristics", categoryId] as const;
}

export function useCategoryCharacteristics(categoryId: string) {
	const queryClient = useQueryClient();
	const endpoint = () =>
		api().admin["product-categories"]({ productCategoryId: categoryId })
			.characteristics;

	const { data, isLoading, error } = useQuery({
		queryKey: categoryCharacteristicsKey(categoryId),
		queryFn: async () => {
			const res = await endpoint().get();
			if (res.error)
				throw new Error(
					res.error.value?.message ||
						"Errore nel caricamento delle caratteristiche",
				);
			return res.data?.data ?? [];
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
			const res = await endpoint()({
				characteristicId: p.characteristicId,
			}).put({
				required: p.required,
			});
			if (res.error)
				throw new Error(
					res.error.value?.message || "Errore durante il salvataggio",
				);
		},
		onSuccess: refresh,
		onError: (e: Error) => toast.error(e.message),
	});

	const remove = useMutation({
		mutationFn: async (p: {
			characteristicId: string;
			confirmAffected: number;
		}) => {
			const res = await endpoint()({
				characteristicId: p.characteristicId,
			}).delete({
				confirmAffected: p.confirmAffected,
			});
			if (res.error)
				throw new Error(
					res.error.value?.message || "Errore durante la rimozione",
				);
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
