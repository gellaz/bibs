import { Clock, MapPin } from "lucide-react";
import { useState } from "react";
import type { StoreCardView } from "./use-store-search";

/** Metri → "240 m" / "1,2 km" (convenzione italiana, virgola decimale). */
function formatDistance(meters: number): string {
	if (meters < 1000) return `${Math.round(meters)} m`;
	return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

function TileImage({ url, name }: { url: string | null; name: string }) {
	const [failed, setFailed] = useState(false);
	if (!url || failed) {
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

/** Riga di stato apertura: "Aperto · chiude alle 19:30" / "Chiuso · apre ...". */
function OpenStatusLine({ status }: { status: StoreCardView["openStatus"] }) {
	let label: string;
	if (status.isOpen) {
		label = status.closesAt ? `Aperto · chiude ${status.closesAt}` : "Aperto";
	} else if (status.opensAt) {
		label = `Chiuso · apre ${status.opensAt.date} ${status.opensAt.time}`;
	} else {
		label = "Chiuso";
	}
	return (
		<span
			className={`inline-flex items-center gap-1 text-xs ${
				status.isOpen ? "text-primary" : "text-muted-foreground"
			}`}
		>
			<Clock className="size-3" aria-hidden />
			{label}
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
		<article className="flex flex-col gap-3">
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
				<h3 className="line-clamp-2 font-medium text-[0.9375rem] text-foreground leading-snug">
					{store.name}
				</h3>
				<p className="text-muted-foreground text-sm">
					{store.category ? `${store.category.name} · ` : ""}
					{store.city} ({store.province})
				</p>
				<OpenStatusLine status={store.openStatus} />
			</div>
		</article>
	);
}
