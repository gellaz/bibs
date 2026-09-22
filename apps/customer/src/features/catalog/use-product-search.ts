import { useInfiniteQuery } from "@tanstack/react-query";
import type { Coords } from "@/features/location/coords";
import { api } from "@/lib/api";

/** Forma stabile per la UI, disaccoppiata dal tipo inferito da Eden. */
export interface ProductCardView {
	id: string;
	name: string;
	price: string;
	discountedPrice: string | null;
	discountPercent: number | null;
	/** Metri dall'origine, `null` senza origine. */
	distance: number | null;
	images: { url: string }[];
	/** Riga `store_products` del negozio agganciato: è ciò che "Aggiungi" usa. */
	storeProductId: string;
	stock: number;
	store: { id: string; name: string; city: string; province: string };
	otherStoreCount: number;
}

interface UseProductSearchArgs {
	q?: string;
	categoryId?: string;
	macroCategoryId?: string;
	coords: Coords | null;
	/** Raggio in km. Ignorato finché non c'è una posizione. */
	radius?: number;
	openNow?: boolean;
	onSale?: boolean;
	minPrice?: number;
	maxPrice?: number;
	limit?: number;
}

export function useProductSearch({
	q,
	categoryId,
	macroCategoryId,
	coords,
	radius,
	openNow,
	onSale,
	minPrice,
	maxPrice,
	limit = 20,
}: UseProductSearchArgs) {
	const query = useInfiniteQuery({
		queryKey: [
			"product-search",
			q ?? "",
			categoryId ?? "",
			macroCategoryId ?? "",
			coords?.lat ?? null,
			coords?.lng ?? null,
			radius ?? null,
			openNow ?? false,
			onSale ?? false,
			minPrice ?? null,
			maxPrice ?? null,
			limit,
		],
		staleTime: 60_000,
		initialPageParam: 1,
		queryFn: async ({ pageParam }) => {
			const { data, error } = await api().customer.products.get({
				query: {
					page: pageParam,
					limit,
					...(q ? { q } : {}),
					...(categoryId ? { categoryId } : {}),
					...(macroCategoryId ? { macroCategoryId } : {}),
					...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
					...(coords && radius ? { radius } : {}),
					...(openNow ? { openNow } : {}),
					...(onSale ? { onSale } : {}),
					...(minPrice !== undefined ? { minPrice } : {}),
					...(maxPrice !== undefined ? { maxPrice } : {}),
				},
			});
			if (error) {
				throw new Error(`Ricerca prodotti non riuscita (${error.status})`);
			}
			return data;
		},
		getNextPageParam: (lastPage) => {
			const { page, limit: lim, total } = lastPage.pagination;
			return page * lim < total ? page + 1 : undefined;
		},
	});

	const products: ProductCardView[] =
		query.data?.pages.flatMap((p) =>
			p.data.map((r) => ({
				id: r.id,
				name: r.name,
				price: r.price,
				discountedPrice: r.discountedPrice,
				discountPercent: r.discountPercent,
				distance: r.distance,
				images: r.images.map((img) => ({ url: img.url })),
				storeProductId: r.storeProductId,
				stock: r.stock,
				store: {
					id: r.store.id,
					name: r.store.name,
					city: r.store.municipality.name,
					province: r.store.municipality.provinceAcronym,
				},
				otherStoreCount: r.otherStoreCount,
			})),
		) ?? [];

	return {
		products,
		total: query.data?.pages[0]?.pagination.total ?? 0,
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isFetchingNextPage: query.isFetchingNextPage,
		isPending: query.isPending,
		isError: query.isError,
		refetch: query.refetch,
	};
}
