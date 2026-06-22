import { DiscountedPrice } from "@bibs/ui/components/discounted-price";
import { MapPin } from "lucide-react";
import { useState } from "react";
import type { NearbyProduct } from "./use-nearby-products";

/** Metri → "240 m" / "1,2 km" (convenzione italiana, virgola decimale). */
function formatDistance(meters: number): string {
	if (meters < 1000) {
		return `${Math.round(meters)} m`;
	}
	const km = meters / 1000;
	return `${km.toFixed(1).replace(".", ",")} km`;
}

function TileImage({ url, name }: { url: string | undefined; name: string }) {
	const [failed, setFailed] = useState(false);

	if (!url || failed) {
		// Fallback identitario: l'iniziale del prodotto invece di un'icona
		// generica, così una griglia senza foto resta varia e leggibile (vale
		// anche per i prodotti che un negozio pubblica senza immagine).
		const initial = name.trim().charAt(0).toUpperCase() || "?";
		return (
			<div className="flex size-full items-center justify-center bg-muted">
				<span
					aria-hidden
					className="font-display font-semibold text-4xl text-muted-foreground/70"
				>
					{initial}
				</span>
			</div>
		);
	}

	return (
		<img
			src={url}
			alt={name}
			loading="lazy"
			decoding="async"
			onError={() => setFailed(true)}
			className="size-full object-cover"
		/>
	);
}

interface ProductTileProps {
	product: NearbyProduct;
	/** Mostra la pill della distanza (solo quando c'è una posizione). */
	showDistance: boolean;
}

/**
 * Tile prodotto del feed di scoperta. Presentazionale: non c'è ancora una
 * pagina di dettaglio prodotto, quindi non è un link (niente controlli morti).
 * Immagine con fallback caldo, nome, prezzo (con sconto se attivo) e — quando
 * conosciamo la posizione — la distanza in mono, voce della Market Square.
 */
export function ProductTile({ product, showDistance }: ProductTileProps) {
	const cover = product.images[0]?.url;
	const hasDistance = showDistance && product.distance > 0;

	return (
		<article className="flex flex-col gap-3">
			<div className="relative aspect-square overflow-hidden rounded-lg border border-border">
				<TileImage url={cover} name={product.name} />
				{hasDistance && (
					<span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-cream px-2 py-1 font-medium font-mono text-ink text-xs tabular-nums shadow-sm">
						<MapPin className="size-3 text-saffron-deep" aria-hidden />
						{formatDistance(product.distance)}
					</span>
				)}
			</div>
			<div className="flex flex-col gap-1">
				<h3 className="line-clamp-2 font-medium text-[0.9375rem] text-foreground leading-snug">
					{product.name}
				</h3>
				<DiscountedPrice
					size="sm"
					className="font-semibold text-foreground tabular-nums"
					originalPrice={product.price}
					discountedPrice={product.discountedPrice}
					percent={product.discountPercent}
				/>
			</div>
		</article>
	);
}
