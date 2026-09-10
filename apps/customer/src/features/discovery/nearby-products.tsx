import { Button } from "@bibs/ui/components/button";
import { Compass, LocateFixed, MapPin, RotateCw } from "lucide-react";
import { Notice } from "@/components/notice";
import { GRID, TileSkeleton } from "@/components/tile";
import { ProductTile } from "@/features/catalog/product-tile";
import { m } from "@/paraglide/messages";
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
						{m.discovery_nearby_title()}
					</h2>
					<p className="text-muted-foreground text-sm">
						{m.discovery_nearby_subtitle()}
					</p>
				</div>

				{geoStatus === "granted" ? (
					<span className="inline-flex items-center gap-1.5 text-saffron-deep text-sm dark:text-saffron">
						<LocateFixed className="size-4" aria-hidden />
						{m.discovery_sorted_by_distance()}
					</span>
				) : (
					<Button
						variant="secondary"
						size="sm"
						onClick={requestLocation}
						disabled={geoStatus === "pending"}
					>
						<MapPin className="size-4" aria-hidden />
						{geoStatus === "pending"
							? m.discovery_locating()
							: m.discovery_show_distances()}
					</Button>
				)}
			</div>

			{(geoStatus === "denied" || geoStatus === "unsupported") && (
				<p className="mt-3 text-muted-foreground text-xs">
					{geoStatus === "denied"
						? m.discovery_location_denied()
						: m.discovery_location_unsupported()}
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
