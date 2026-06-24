import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface NoticeProps {
	icon: LucideIcon;
	title: string;
	description: string;
	action?: ReactNode;
	/** Heading tag — h3 in-page (default), h1 for full-page states. */
	as?: "h1" | "h2" | "h3";
}

/**
 * Stato vuoto/errore on-brand (tono caldo + ink), senza l'accent cobalt del
 * register riservato a seller/admin.
 */
export function Notice({
	icon: Icon,
	title,
	description,
	action,
	as: Heading = "h3",
}: NoticeProps) {
	return (
		<div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed px-6 py-14 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
				<Icon className="size-6" aria-hidden />
			</div>
			<div className="space-y-1">
				<Heading className="font-display font-semibold text-foreground text-lg">
					{title}
				</Heading>
				<p className="mx-auto max-w-sm text-muted-foreground text-sm leading-relaxed">
					{description}
				</p>
			</div>
			{action}
		</div>
	);
}

/** Variante full-page (centrata, heading h1) per gli stati di pagina intera. */
export function NoticePage(props: Omit<NoticeProps, "as">) {
	return (
		<div className="mx-auto w-full max-w-3xl px-4 py-16">
			<Notice {...props} as="h1" />
		</div>
	);
}
