import { useState } from "react";
import { TileImage } from "@/components/tile";
import { m } from "@/paraglide/messages";

/**
 * Foto principale quadrata e, se ce n'è più d'una, miniature che la
 * sostituiscono. Senza foto, il segnaposto dei tile.
 */
export function ProductGallery({
	images,
	name,
}: {
	images: { id: string; url: string }[];
	name: string;
}) {
	const [index, setIndex] = useState(0);
	const current = images[index] ?? images[0];

	return (
		<div className="space-y-3">
			<div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
				<TileImage
					key={current?.url}
					url={current?.url}
					name={name}
					loading="eager"
				/>
			</div>
			{images.length > 1 && (
				<ul
					aria-label={m.product_detail_gallery_aria()}
					className="flex gap-2 overflow-x-auto pb-1"
				>
					{images.map((img, i) => (
						<li key={img.id} className="shrink-0">
							<button
								type="button"
								aria-label={m.product_detail_photo_aria({ index: i + 1 })}
								aria-pressed={i === index}
								onClick={() => setIndex(i)}
								className="block size-16 overflow-hidden rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-foreground"
							>
								<img
									src={img.url}
									alt=""
									loading="lazy"
									decoding="async"
									className="size-full object-cover"
								/>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
