import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "~/lib/utils";

/**
 * Toni di stato, decisi da chi guarda (DESIGN.md §5 Status Badge): tocca a te,
 * aspetti qualcun altro, pronto/attivo, chiuso, fallito. Uguali nelle tre app.
 */
export type StatusTone =
	| "action"
	| "waiting"
	| "success"
	| "closed"
	| "destructive";

const TONE_CLASS: Record<StatusTone, string> = {
	action: "text-action bg-action/12 border-action/40",
	waiting: "text-waiting bg-waiting/12 border-waiting/40",
	success: "text-success bg-success/12 border-success/40",
	closed: "text-muted-foreground border-border",
	destructive: "text-destructive bg-destructive/12 border-destructive/40",
};

export interface StatusBadgeProps {
	tone: StatusTone;
	/** Icona dello stato (non del tono): pacco = da preparare, camion = spedito. */
	icon: LucideIcon;
	children: React.ReactNode;
	/** Passo raggiunto in un flusso: «current/total» accanto, `label` per i lettori di schermo. */
	step?: { current: number; total: number; label: string };
	className?: string;
}

export function StatusBadge({
	tone,
	icon: Icon,
	children,
	step,
	className,
}: StatusBadgeProps) {
	const badge = (
		<span
			data-slot="status-badge"
			data-tone={tone}
			className={cn(
				"inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border pr-2.5 pl-1.5 text-xs font-medium",
				TONE_CLASS[tone],
				className,
			)}
		>
			<Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.25} />
			{children}
		</span>
	);
	if (!step) return badge;
	return (
		<span className="inline-flex items-center gap-2">
			{badge}
			<span aria-hidden className="text-xs tabular-nums text-muted-foreground">
				{step.current}/{step.total}
			</span>
			<span className="sr-only">{step.label}</span>
		</span>
	);
}
