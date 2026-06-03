import { CircleDashedIcon, SearchXIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

// L'icona è fissata per variante, non scelta dal call-site: ogni superficie
// vuota parla la stessa lingua visiva in tutta l'app.
const VARIANT_ICON = {
	/** Vuoto genuino: non esiste ancora niente in questa vista. */
	empty: CircleDashedIcon,
	/** Una ricerca o un filtro non ha prodotto risultati. */
	"no-results": SearchXIcon,
} as const;

export interface EmptyStateProps {
	variant?: keyof typeof VARIANT_ICON;
	title: string;
	description?: string;
	/** Primary call to action. Pass a fully-rendered Button (or Button-as-Link). */
	action?: ReactNode;
	/** Optional secondary action. Same convention as `action`. */
	secondary?: ReactNode;
	className?: string;
}

export function EmptyState({
	variant = "empty",
	title,
	description,
	action,
	secondary,
	className,
}: EmptyStateProps) {
	const Icon = VARIANT_ICON[variant];
	return (
		<div
			data-slot="empty-state"
			className={cn(
				"mx-auto flex w-full max-w-md flex-col items-center gap-5 py-16 text-center text-balance",
				className,
			)}
		>
			<div
				aria-hidden
				className="flex size-14 items-center justify-center rounded-xl bg-cobalt-soft text-cobalt-deep"
			>
				<Icon className="size-6" />
			</div>
			<div className="space-y-2">
				<h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
					{title}
				</h3>
				{description && (
					<p className="text-sm leading-relaxed text-muted-foreground">
						{description}
					</p>
				)}
			</div>
			{(action || secondary) && (
				<div className="flex flex-wrap items-center justify-center gap-2 pt-1">
					{action}
					{secondary}
				</div>
			)}
		</div>
	);
}
