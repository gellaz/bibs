import { Link } from "@tanstack/react-router";
import { Clock, MapPin } from "lucide-react";
import { formatDistance, TileImage } from "@/components/tile";
import { openStatusLabel } from "./open-status";
import type { StoreCardView } from "./use-store-search";

/** Riga di stato apertura. */
function OpenStatusLine({ status }: { status: StoreCardView["openStatus"] }) {
	return (
		<span
			className={`inline-flex items-center gap-1 text-xs ${
				status.isOpen ? "text-primary" : "text-muted-foreground"
			}`}
		>
			<Clock className="size-3" aria-hidden />
			{openStatusLabel(status)}
		</span>
	);
}

interface StoreTileProps {
	store: StoreCardView;
	/** Show the distance pill (only when we have a position). */
	showDistance: boolean;
}

/**
 * Store tile for the discovery grid. Theme-aware surfaces; the distance pill is
 * an accent ON the photo, so it keeps the fixed cream/ink tokens like the
 * product tile.
 */
export function StoreTile({ store, showDistance }: StoreTileProps) {
	const hasDistance = showDistance && store.distance !== null;
	return (
		<Link
			to="/stores/$storeId"
			params={{ storeId: store.id }}
			className="group flex flex-col gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-saffron"
		>
			<div className="relative aspect-square overflow-hidden rounded-lg border border-border">
				<TileImage url={store.imageUrl} name={store.name} />
				{hasDistance && (
					<span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-cream px-2 py-1 font-medium font-mono text-ink text-xs tabular-nums shadow-sm">
						<MapPin className="size-3 text-saffron-deep" aria-hidden />
						{formatDistance(store.distance as number)}
					</span>
				)}
			</div>
			<div className="flex flex-col gap-1">
				<h3 className="line-clamp-2 font-medium text-[0.9375rem] text-foreground leading-snug group-hover:text-primary">
					{store.name}
				</h3>
				<p className="text-muted-foreground text-sm">
					{store.category ? `${store.category.name} · ` : ""}
					{store.city} ({store.province})
				</p>
				<OpenStatusLine status={store.openStatus} />
			</div>
		</Link>
	);
}
