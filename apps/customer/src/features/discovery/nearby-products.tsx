import { Button } from "@bibs/ui/components/button";
import { Compass, LocateFixed, MapPin, RotateCw } from "lucide-react";
import { Notice } from "@/components/notice";
import { GRID, TileSkeleton } from "@/components/tile";
import { ProductTile } from "@/features/catalog/product-tile";
import { useGeolocation } from "./use-geolocation";
import { useNearbyProducts } from "./use-nearby-products";

export function NearbyProducts() {
	const {
		coords,
		status: geoStatus,
		request: requestLocation,
	} = useGeolocation();
	const {
		data: products,
		isPending,
		isError,
		refetch,
	} = useNearbyProducts(coords);

	return (
		<section aria-labelledby="nearby-heading" className="mt-10 sm:mt-12">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="space-y-1">
					<h2
						id="nearby-heading"
						className="font-bold font-display text-2xl text-primary tracking-[-0.015em]"
					>
						Vicino a te
					</h2>
					<p className="text-muted-foreground text-sm">
						I prodotti disponibili nei negozi della tua zona.
					</p>
				</div>

				{geoStatus === "granted" ? (
					<span className="inline-flex items-center gap-1.5 text-saffron-deep text-sm dark:text-saffron">
						<LocateFixed className="size-4" aria-hidden />
						Distanze dalla tua posizione
					</span>
				) : (
					<Button
						variant="secondary"
						size="sm"
						onClick={requestLocation}
						disabled={geoStatus === "pending"}
					>
						<MapPin className="size-4" aria-hidden />
						{geoStatus === "pending" ? "Rilevamento…" : "Mostra le distanze"}
					</Button>
				)}
			</div>

			{(geoStatus === "denied" || geoStatus === "unsupported") && (
				<p className="mt-3 text-muted-foreground text-xs">
					{geoStatus === "denied"
						? "Posizione non disponibile. Mostriamo comunque cosa c'è in zona."
						: "Il tuo dispositivo non supporta la geolocalizzazione."}
				</p>
			)}

			<div className="mt-6">
				{isPending ? (
					<div className={GRID} aria-hidden>
						{Array.from({ length: 8 }, (_, i) => (
							<TileSkeleton key={`tile-skeleton-${i}`} />
						))}
					</div>
				) : isError ? (
					<Notice
						icon={RotateCw}
						title="Non siamo riusciti a caricare i prodotti"
						description="Qualcosa è andato storto durante il caricamento. Riprova tra un momento."
						action={
							<Button variant="secondary" size="sm" onClick={() => refetch()}>
								<RotateCw className="size-4" aria-hidden />
								Riprova
							</Button>
						}
					/>
				) : products.length === 0 ? (
					<Notice
						icon={Compass}
						title="Ancora niente da scoprire"
						description="Non ci sono ancora prodotti disponibili in zona. Torna a trovarci: i negozi del quartiere stanno arrivando."
					/>
				) : (
					<ul className={GRID}>
						{products.map((product) => (
							<li key={product.id}>
								<ProductTile
									product={product}
									showDistance={geoStatus === "granted"}
								/>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
