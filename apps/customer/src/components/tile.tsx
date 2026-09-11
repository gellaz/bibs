import { Skeleton } from "@bibs/ui/components/skeleton";
import { useState } from "react";

/**
 * Tailwind grid condivisa dalle griglie di tile a piena pagina (prodotti della
 * discovery / negozi). La quinta colonna da `xl` tiene la tile sulla stessa
 * misura di prima ora che il container arriva a 1280px: lo spazio in più
 * diventa densità, non tile gonfiate.
 *
 * Le griglie dentro una colonna più stretta della pagina (il catalogo nella
 * scheda negozio) usano invece una grid a container query: lì la larghezza
 * disponibile non è quella del viewport.
 */
export const GRID =
	"grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

/** Metri → "240 m" / "1,2 km" (convenzione italiana, virgola decimale). */
export function formatDistance(meters: number): string {
	if (meters < 1000) return `${Math.round(meters)} m`;
	return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

/**
 * Cover di un tile: immagine con fallback identitario (l'iniziale del nome)
 * quando manca l'URL o il caricamento fallisce.
 */
export function TileImage({
	url,
	name,
}: {
	url: string | null | undefined;
	name: string;
}) {
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

/** Skeleton di un tile (cover quadrata + due righe di testo). */
export function TileSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<Skeleton className="aspect-square rounded-lg" />
			<div className="flex flex-col gap-1.5">
				<Skeleton className="h-4 w-4/5" />
				<Skeleton className="h-4 w-1/3" />
			</div>
		</div>
	);
}
