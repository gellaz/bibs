import { Button } from "@bibs/ui/components/button";
import { RotateCw } from "lucide-react";
import { GRID, TileSkeleton } from "@/components/tile";
import { ProductTile } from "@/features/catalog/product-tile";
import { useStoreProducts } from "./use-store-products";

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
		<section className="space-y-3">
			<h2 className="font-display font-semibold text-foreground text-lg">
				Prodotti
			</h2>

			{isPending ? (
				<div className={GRID} aria-hidden>
					{Array.from({ length: 6 }, (_, i) => (
						<TileSkeleton key={`product-skeleton-${i}`} />
					))}
				</div>
			) : isError ? (
				<div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed px-6 py-12 text-center">
					<p className="text-muted-foreground text-sm">
						Non siamo riusciti a caricare i prodotti.
					</p>
					<Button variant="secondary" size="sm" onClick={() => refetch()}>
						<RotateCw className="size-4" aria-hidden />
						Riprova
					</Button>
				</div>
			) : (
				<>
					<ul className={GRID}>
						{products.map((product) => (
							<li key={product.id}>
								<ProductTile product={product} showDistance={false} />
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
								{isFetchingNextPage ? "Caricamento…" : "Carica altri"}
							</Button>
						</div>
					)}
				</>
			)}
		</section>
	);
}
