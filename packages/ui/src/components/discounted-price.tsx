import { cn } from "../lib/utils";
import { Badge } from "./badge";
import { formatPriceEur } from "./price";

export interface DiscountedPriceProps {
	originalPrice: string | number;
	discountedPrice?: string | number | null;
	percent?: number | null;
	className?: string;
	size?: "sm" | "md" | "lg";
}

export function DiscountedPrice({
	originalPrice,
	discountedPrice,
	percent,
	className,
	size = "md",
}: DiscountedPriceProps) {
	const hasDiscount =
		discountedPrice !== null &&
		discountedPrice !== undefined &&
		percent !== null &&
		percent !== undefined;

	const mainSize =
		size === "lg"
			? "text-2xl font-semibold"
			: size === "sm"
				? "text-sm font-medium"
				: "text-base font-medium";
	const strikeSize = size === "lg" ? "text-base" : "text-xs";

	if (!hasDiscount) {
		return (
			<span className={cn("inline-flex items-baseline", mainSize, className)}>
				{formatPriceEur(originalPrice)}
			</span>
		);
	}

	return (
		<span className={cn("inline-flex items-baseline gap-2", className)}>
			<span className={cn("text-foreground", mainSize)}>
				{formatPriceEur(discountedPrice)}
			</span>
			<span className={cn("text-muted-foreground line-through", strikeSize)}>
				{formatPriceEur(originalPrice)}
			</span>
			<Badge variant="secondary" className="text-xs">
				-{percent}%
			</Badge>
		</span>
	);
}
