import type { ReactNode } from "react";

/** Titolo di pagina del back-office; `children` sono le azioni a destra. */
export function PageHeader({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children?: ReactNode;
}) {
	return (
		<div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
			<div>
				<h1 className="font-display text-2xl font-semibold tracking-tight">
					{title}
				</h1>
				{description && (
					<p className="text-muted-foreground text-sm">{description}</p>
				)}
			</div>
			{children}
		</div>
	);
}
