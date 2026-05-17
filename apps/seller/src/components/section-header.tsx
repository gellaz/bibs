import type { ReactNode } from "react";

export interface SectionHeaderProps {
	title: string;
	subtitle?: string;
	actions?: ReactNode;
}

export function SectionHeader({
	title,
	subtitle,
	actions,
}: SectionHeaderProps) {
	return (
		<header className="flex items-start justify-between gap-4 border-b pb-6">
			<div className="min-w-0 space-y-1">
				<h2 className="font-display text-2xl leading-tight font-semibold tracking-tight">
					{title}
				</h2>
				{subtitle && (
					<p className="text-muted-foreground text-sm">{subtitle}</p>
				)}
			</div>
			{actions && <div className="shrink-0">{actions}</div>}
		</header>
	);
}
