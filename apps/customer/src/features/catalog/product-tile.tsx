import { DiscountedPrice } from "@bibs/ui/components/discounted-price";
import { Link } from "@tanstack/react-router";
import { MapPin, Store as StoreIcon } from "lucide-react";
import type { ReactNode } from "react";
import { formatDistance, TileImage } from "@/components/tile";
import { m } from "@/paraglide/messages";

/** Forma dati minima per un tile prodotto (ricerca, discovery o catalogo negozio). */
export interface ProductCardData {
	id: string;
	name: string;
	price: string;
	images: { url: string }[];
	discountedPrice: string | null;
	discountPercent: number | null;
	/** Distanza in metri dal punto di ricerca; assente o null quando non geo-rilevante. */
	distance?: number | null;
	/**
	 * Il negozio agganciato al risultato. Assente nel catalogo di una scheda
	 * negozio: lì il negozio è la pagina, ripeterlo su ogni tile è rumore.
	 */
	store?: { id: string; name: string; city: string; province: string };
	/** Altri negozi che hanno il prodotto fra quelli filtrati. */
	otherStoreCount?: number;
}

interface ProductTileProps {
	product: ProductCardData;
	/** Mostra la pill della distanza (solo quando c'è una posizione). */
	showDistance: boolean;
	/**
	 * Azione opzionale sotto il prezzo. Dove il negozio è agganciato al
	 * risultato, qui va `AddToCart` con il suo `storeProductId`.
	 */
	action?: ReactNode;
	/**
	 * Il negozio da mettere nel link alla scheda quando il prodotto non ne
	 * porta uno (catalogo della scheda negozio: il negozio è la pagina).
	 */
	storeId?: string;
}

/**
 * Tile prodotto presentazionale. Portano alla scheda l'immagine e il nome, non
 * l'intero riquadro: dentro ci sono altri controlli (il link al negozio, lo
 * stepper del carrello) e un'area cliccabile che li contiene darebbe click
 * ambigui. Il link porta con sé il negozio del tile, così la scheda aggancia
 * lo stesso.
 */
export function ProductTile({
	product,
	showDistance,
	action,
	storeId,
}: ProductTileProps) {
	const cover = product.images[0]?.url;
	const hasDistance = showDistance && (product.distance ?? 0) > 0;
	const others = product.otherStoreCount ?? 0;
	const linkProps = {
		to: "/products/$productId",
		params: { productId: product.id },
		search: { store: product.store?.id ?? storeId },
	} as const;

	return (
		<article className="flex h-full flex-col gap-3">
			<div className="relative aspect-square overflow-hidden rounded-lg border border-border">
				<Link
					{...linkProps}
					tabIndex={-1}
					aria-hidden
					className="block size-full"
				>
					<TileImage url={cover} name={product.name} />
				</Link>
				{hasDistance && (
					<span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-cream px-2 py-1 font-medium font-mono text-ink text-xs tabular-nums shadow-sm">
						<MapPin className="size-3 text-saffron-deep" aria-hidden />
						{formatDistance(product.distance ?? 0)}
					</span>
				)}
			</div>
			<div className="flex flex-1 flex-col gap-1">
				<h3 className="line-clamp-2 font-medium text-[0.9375rem] text-foreground leading-snug">
					<Link
						{...linkProps}
						className="hover:underline focus-visible:underline"
					>
						{product.name}
					</Link>
				</h3>
				<DiscountedPrice
					size="sm"
					className="font-semibold text-foreground tabular-nums"
					originalPrice={product.price}
					discountedPrice={product.discountedPrice}
					percent={product.discountPercent}
				/>
				{product.store && (
					<p className="mt-0.5 flex min-w-0 items-start gap-1 text-muted-foreground text-xs leading-snug">
						<StoreIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
						<span className="min-w-0 break-words">
							<Link
								to="/stores/$storeId"
								params={{ storeId: product.store.id }}
								aria-label={m.product_store_link_aria({
									store: product.store.name,
								})}
								className="rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 focus-visible:ring-2 focus-visible:ring-saffron"
							>
								{product.store.name}
							</Link>
							<span className="text-muted-foreground">
								{" — "}
								{product.store.city} ({product.store.province})
							</span>
							{others > 0 && (
								<span className="block">
									{others === 1
										? m.product_other_stores_one()
										: m.product_other_stores({ count: others })}
								</span>
							)}
						</span>
					</p>
				)}
				{action ? <div className="mt-auto pt-3">{action}</div> : null}
			</div>
		</article>
	);
}
