import { DiscountedPrice } from "@bibs/ui/components/discounted-price";
import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { formatDistance } from "@/components/tile";
import { AddToCart } from "@/features/cart/add-to-cart";
import { m } from "@/paraglide/messages";
import type { ProductDetailView } from "./product-detail-api";

/**
 * Prezzo, negozio e carrello: il blocco che vende. Saffron solo sull'icona del
 * luogo (la «presenza» di DESIGN.md), il resto è inchiostro su carta.
 */
export function ProductOffer({ product }: { product: ProductDetailView }) {
	const { offer } = product;
	const others = product.otherStoreCount;

	return (
		<div className="space-y-5">
			<DiscountedPrice
				size="lg"
				className="font-semibold text-foreground tabular-nums"
				originalPrice={product.price}
				discountedPrice={product.discountedPrice}
				percent={product.discountPercent}
			/>

			<div className="space-y-3 border-border border-t pt-5">
				{product.requestedStoreUnavailable && (
					<p className="text-muted-foreground text-sm">
						{m.product_detail_requested_store_unavailable()}
					</p>
				)}
				<p className="text-muted-foreground text-xs">
					{m.product_detail_sold_by()}
				</p>
				<div className="flex items-start gap-2">
					<MapPin
						className="mt-0.5 size-4 shrink-0 text-saffron-deep"
						aria-hidden
					/>
					<div className="min-w-0 text-sm leading-snug">
						<Link
							to="/stores/$storeId"
							params={{ storeId: offer.store.id }}
							className="font-medium text-foreground hover:underline focus-visible:underline"
						>
							{offer.store.name}
						</Link>
						<span className="block text-muted-foreground">
							{offer.store.municipality.name} (
							{offer.store.municipality.provinceAcronym})
							{offer.distance !== null && offer.distance > 0 && (
								<>
									{" "}
									·{" "}
									<span className="tabular-nums">
										{formatDistance(offer.distance)}
									</span>
								</>
							)}
						</span>
					</div>
				</div>
				<div className="max-w-xs">
					<AddToCart
						storeProductId={offer.storeProductId}
						stock={offer.stock}
						productName={product.name}
					/>
				</div>
				{others > 0 && (
					<p className="text-muted-foreground text-xs">
						{others === 1
							? m.product_detail_other_stores_one()
							: m.product_detail_other_stores({ count: others })}
					</p>
				)}
			</div>
		</div>
	);
}
