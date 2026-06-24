import { useInfiniteQuery } from "@tanstack/react-query";
import type { ProductCardData } from "@/features/catalog/product-tile";
import { api } from "@/lib/api";

/**
 * Catalogo prodotti di un negozio, via endpoint pubblico
 * `/customer/stores/:id/products`. Paginazione "Carica altri" (infinite query).
 * Nessuna distanza (sei già sul negozio) e nessuna data nel DTO → mappatura
 * diretta sulla forma stabile del tile, senza coercion.
 */
export function useStoreProducts(storeId: string, limit = 12) {
	const query = useInfiniteQuery({
		queryKey: ["store-products", storeId, limit],
		staleTime: 60_000,
		initialPageParam: 1,
		queryFn: async ({ pageParam }) => {
			const { data, error } = await api()
				.customer.stores({ id: storeId })
				.products.get({ query: { page: pageParam, limit } });
			if (error) {
				throw new Error(`Caricamento prodotti non riuscito (${error.status})`);
			}
			return data;
		},
		getNextPageParam: (lastPage) => {
			const { page, limit: lim, total } = lastPage.pagination;
			return page * lim < total ? page + 1 : undefined;
		},
	});

	const products: ProductCardData[] =
		query.data?.pages.flatMap((p) =>
			p.data.map((prod) => ({
				id: prod.id,
				name: prod.name,
				price: prod.price,
				images: prod.images.map((img) => ({ url: img.url })),
				discountedPrice: prod.discountedPrice,
				discountPercent: prod.discountPercent,
			})),
		) ?? [];

	return {
		products,
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isFetchingNextPage: query.isFetchingNextPage,
		isPending: query.isPending,
		isError: query.isError,
		refetch: query.refetch,
	};
}
