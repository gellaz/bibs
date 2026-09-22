import { Button } from "@bibs/ui/components/button";
import { Compass, LocateFixed, MapPin, RotateCw } from "lucide-react";
import { Notice } from "@/components/notice";
import { GRID, TileSkeleton } from "@/components/tile";
import { ProductTile } from "@/features/catalog/product-tile";
import { originLabel } from "@/features/location/origin-label";
import { useSearchOrigin } from "@/features/location/search-origin";
import { m } from "@/paraglide/messages";
import { useNearbyProducts } from "./use-nearby-products";

export function NearbyProducts() {
	const { origin, coords, geoStatus, setPickerOpen } = useSearchOrigin();
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
						{m.discovery_nearby_title()}
					</h2>
					<p className="text-muted-foreground text-sm">
						{m.discovery_nearby_subtitle()}
					</p>
				</div>

				{coords ? (
					<span className="inline-flex items-center gap-1.5 text-saffron-deep text-sm dark:text-saffron">
						<LocateFixed className="size-4" aria-hidden />
						{m.origin_distances_from({ label: originLabel(origin, geoStatus) })}
					</span>
				) : (
					// Il perché di un GPS negato o assente sta nel selettore, accanto
					// alla voce che lo riguarda: qui si dice solo che manca un punto
					// di partenza, e si offre il gesto per sceglierlo.
					<Button
						variant="secondary"
						size="sm"
						className="min-h-11 sm:min-h-9"
						onClick={() => setPickerOpen(true)}
					>
						<MapPin className="size-4" aria-hidden />
						{m.origin_choose()}
					</Button>
				)}
			</div>

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
						title={m.discovery_load_error_title()}
						description={m.discovery_load_error_description()}
						action={
							<Button variant="secondary" size="sm" onClick={() => refetch()}>
								<RotateCw className="size-4" aria-hidden />
								{m.discovery_retry()}
							</Button>
						}
					/>
				) : products.length === 0 ? (
					<Notice
						icon={Compass}
						title={m.discovery_empty_title()}
						description={m.discovery_empty_description()}
					/>
				) : (
					<ul className={GRID}>
						{products.map((product) => (
							<li key={product.id}>
								<ProductTile
									product={{
										...product,
										distance: product.distance ?? undefined,
									}}
									showDistance={coords !== null}
								/>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
