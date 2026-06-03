import { PencilIcon, PlusIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

export interface EntityFormHeaderProps {
	/** Drives the default icon (Plus / Pencil) when `icon` is not supplied. */
	mode?: "create" | "edit";
	/** Explicit icon, overriding the `mode` default (e.g. a settings surface). */
	icon?: ComponentType<{ className?: string }>;
	title?: string;
	placeholder: string;
	subtitle?: string;
	badge?: ReactNode;
	menu?: ReactNode;
}

export function EntityFormHeader({
	mode = "edit",
	icon,
	title,
	placeholder,
	subtitle,
	badge,
	menu,
}: EntityFormHeaderProps) {
	const Icon = icon ?? (mode === "create" ? PlusIcon : PencilIcon);
	const hasTitle = title != null && title.trim() !== "";

	return (
		<header className="border-b pb-6">
			<div className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 items-start gap-4">
					<div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-cobalt-soft text-cobalt-deep">
						<Icon className="size-5" />
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
