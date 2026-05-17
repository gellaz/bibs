import { PencilIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EntityFormHeaderProps {
	mode: "create" | "edit";
	title?: string;
	placeholder: string;
	subtitle?: string;
	badge?: ReactNode;
	menu?: ReactNode;
}

export function EntityFormHeader({
	mode,
	title,
	placeholder,
	subtitle,
	badge,
	menu,
}: EntityFormHeaderProps) {
	const Icon = mode === "create" ? PlusIcon : PencilIcon;
	const hasTitle = title != null && title.trim() !== "";

	return (
		<header className="border-b pb-6">
			<div className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 items-start gap-4">
					<div className="relative shrink-0 isolate">
						<div
							aria-hidden
							className="absolute -inset-3 rounded-full bg-blue-400/40 blur-2xl dark:bg-blue-500/40"
						/>
						<div
							aria-hidden
							className="relative flex size-14 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-200/60 ring-inset dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-400/20"
						>
							<Icon className="size-6" />
						</div>
					</div>
					<div className="min-w-0 space-y-1">
						<h1 className="font-display text-2xl leading-tight font-semibold tracking-tight">
							{hasTitle ? (
								<span className="text-foreground">{title}</span>
							) : (
								<span className="text-muted-foreground">{placeholder}</span>
							)}
						</h1>
						{subtitle && (
							<p className="text-muted-foreground text-sm">{subtitle}</p>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{badge}
					{menu}
				</div>
			</div>
		</header>
	);
}
