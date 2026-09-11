import { Link } from "@tanstack/react-router";
import { ChevronLeft, Clock } from "lucide-react";
import { useState } from "react";
import { PAGE_CONTAINER } from "@/components/page";
import { type OpenStatusView, openStatusLabel } from "./open-status";

interface StoreCoverProps {
	name: string;
	imageUrl: string | null;
	categoryName: string | null;
	city: string;
	province: string;
	openStatus: OpenStatusView;
}

export function StoreCover({
	name,
	imageUrl,
	categoryName,
	city,
	province,
	openStatus,
}: StoreCoverProps) {
	const [failed, setFailed] = useState(false);
	const showImage = imageUrl && !failed;
	const initial = name.trim().charAt(0).toUpperCase() || "?";

	return (
		<div className="relative h-64 w-full overflow-hidden sm:h-80 xl:h-96">
			{showImage ? (
				<>
					<img
						src={imageUrl}
						alt={name}
						decoding="async"
						onError={() => setFailed(true)}
						className="absolute inset-0 size-full object-cover"
					/>
					<div
						className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/25 to-transparent"
						aria-hidden
					/>
				</>
			) : (
				<div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-saffron to-saffron-deep">
					<span
						aria-hidden
						className="font-display font-semibold text-7xl text-cream/90"
					>
						{initial}
					</span>
				</div>
			)}

			<div className={`${PAGE_CONTAINER} absolute inset-x-0 top-4`}>
				<Link
					to="/stores"
					search={{ q: undefined, categoryId: undefined }}
					className="inline-flex items-center gap-1 rounded-full bg-ink/40 px-3 py-1.5 font-medium text-cream text-sm backdrop-blur-sm transition-colors hover:bg-ink/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream focus-visible:ring-offset-2 focus-visible:ring-offset-ink/40"
				>
					<ChevronLeft className="size-4" aria-hidden />
					Negozi
				</Link>
			</div>

			<div
				className={`${PAGE_CONTAINER} absolute inset-x-0 bottom-0 pb-5 sm:pb-6`}
			>
				<h1 className="font-bold font-display text-3xl text-cream leading-tight tracking-[-0.015em] drop-shadow-sm sm:text-4xl">
					{name}
				</h1>
				<p className="mt-1 text-cream/85 text-sm">
					{categoryName ? `${categoryName} · ` : ""}
					{city} ({province})
				</p>
				<span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-cream px-2.5 py-1 font-medium text-ink text-xs">
					<Clock
						className={`size-3.5 ${
							openStatus.isOpen ? "text-saffron-deep" : "text-ink/60"
						}`}
						aria-hidden
					/>
					{openStatusLabel(openStatus)}
				</span>
			</div>
		</div>
	);
}
