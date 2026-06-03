import { cn } from "@bibs/ui/lib/utils";
import type { ReactNode } from "react";

interface FormSectionProps {
	title: string;
	description?: string;
	children: ReactNode;
	/**
	 * Color the section title. Use `destructive` for danger zones.
	 */
	tone?: "default" | "destructive";
	/**
	 * Lay the fields on a responsive 2-column grid: short fields pair up, wide
	 * ones (textarea, dropzone, pickers) opt out with `col-span-full`. Off keeps
	 * a single stacked column. The grid is container-query driven, so a section
	 * placed in a narrow column (e.g. a sidebar) stays single-column on its own.
	 */
	grid?: boolean;
	className?: string;
}

/**
 * A compact back-office form section: a thin title row with a hairline rule,
 * then the fields. Shared by the seller product and store forms so every
 * back-office form reads with the same rhythm. The title sits on top (not in a
 * side column) so the full width stays available for inputs.
 */
export function FormSection({
	title,
	description,
	children,
	tone = "default",
	grid = false,
	className,
}: FormSectionProps) {
	return (
		<section className={cn("@container", className)}>
			<header className="mb-5 border-b border-warm-line pb-2.5">
				<h2
					className={cn(
						"text-base font-semibold tracking-tight",
						tone === "destructive" ? "text-destructive" : "text-foreground",
					)}
				>
					{title}
				</h2>
				{description && (
					<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
						{description}
					</p>
				)}
			</header>
			<div
				className={cn(
					grid
						? "grid grid-cols-1 gap-x-6 gap-y-4 @md:grid-cols-2"
						: "space-y-4",
				)}
			>
				{children}
			</div>
		</section>
	);
}
