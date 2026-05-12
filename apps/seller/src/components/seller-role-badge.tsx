import { Badge } from "@bibs/ui/components/badge";

export type SellerRole = "seller" | "employee";

type Props = {
	userRole: SellerRole | string | undefined | null;
	className?: string;
};

export function SellerRoleBadge({ userRole, className }: Props) {
	const isOwner = userRole === "seller";
	const variantClass = isOwner
		? "border-saffron-deep/50 bg-saffron/15 text-saffron-deep dark:bg-saffron/20"
		: "border-ink-soft/40 bg-ink-soft/10 text-ink-soft dark:border-primary/40 dark:bg-primary/15 dark:text-primary";
	const dotClass = isOwner ? "bg-saffron-deep" : "bg-ink-soft dark:bg-primary";

	return (
		<Badge
			variant="outline"
			className={[variantClass, className].filter(Boolean).join(" ")}
		>
			<span
				aria-hidden="true"
				className={`size-1.5 shrink-0 rounded-full ${dotClass}`}
			/>
			{isOwner ? "Titolare" : "Dipendente"}
		</Badge>
	);
}
