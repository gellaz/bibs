import { Button } from "@bibs/ui/components/button";
import { RotateCw } from "lucide-react";
import { TileSkeleton } from "@/components/tile";
import { AddToCart } from "@/features/cart/add-to-cart";
import { ProductTile } from "@/features/catalog/product-tile";
import { m } from "@/paraglide/messages";
import { useStoreProducts } from "./use-store-products";

/**
 * Il catalogo vive nella colonna centrale della scheda, non a piena pagina: le
 * colonne le decide la larghezza della colonna (container query), non quella
 * del viewport. Altrimenti a 1024px il rail ruberebbe spazio e la griglia
 * passerebbe comunque a 4 colonne da 146px.
 */
const CATALOG_GRID =
	"grid grid-cols-2 gap-x-4 gap-y-6 @xl:grid-cols-3 @3xl:grid-cols-4";

export function StoreProducts({ storeId }: { storeId: string }) {
	const {
		products,
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
		isPending,
		isError,
		refetch,
	} = useStoreProducts(storeId);

	// Catalogo vuoto: ometti del tutto la sezione (coerente con le altre sezioni
	// condizionali della scheda), niente box vuoto come prima cosa sotto la cover.
	if (!isPending && !isError && products.length === 0) return null;

	return (
		<section className="@container space-y-4">
			<h2 className="font-display font-semibold text-foreground text-lg">
				{m.store_products_title()}
			</h2>

			{isPending ? (
				<div className={CATALOG_GRID} aria-hidden>
					{Array.from({ length: 6 }, (_, i) => (
						<TileSkeleton key={`product-skeleton-${i}`} />
					))}
				</div>
			) : isError ? (
				<div className="flex flex-col items-center gap-4 rounded-lg border border-border border-dashed px-6 py-12 text-center">
					<p className="text-muted-foreground text-sm">
						{m.store_load_failed()}
					</p>
					<Button variant="secondary" size="sm" onClick={() => refetch()}>
						<RotateCw className="size-4" aria-hidden />
						{m.store_retry()}
					</Button>
				</div>
			) : (
				<>
					<ul className={CATALOG_GRID}>
						{products.map((product) => (
							<li key={product.id}>
								<ProductTile
									product={product}
									showDistance={false}
									action={
										<AddToCart
											storeProductId={product.storeProductId}
											stock={product.stock}
											productName={product.name}
										/>
									}
								/>
							</li>
						))}
					</ul>
					{hasNextPage && (
						<div className="mt-8 flex justify-center">
							<Button
								variant="secondary"
								onClick={() => fetchNextPage()}
								disabled={isFetchingNextPage}
							>
								{isFetchingNextPage ? m.store_loading() : m.store_load_more()}
							</Button>
						</div>
					)}
				</>
			)}
		</section>
	);
}
