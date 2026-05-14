import { cn } from "../lib/utils";
import { Badge } from "./badge";

export interface DiscountedPriceProps {
	originalPrice: string | number;
	discountedPrice?: string | number | null;
	percent?: number | null;
	currency?: string;
	className?: string;
	size?: "sm" | "md" | "lg";
}

function formatPrice(value: string | number, currency = "EUR") {
	const num = typeof value === "string" ? Number.parseFloat(value) : value;
	return new Intl.NumberFormat("it-IT", {
		style: "currency",
		currency,
	}).format(num);
}

export function DiscountedPrice({
	originalPrice,
	discountedPrice,
	percent,
	currency = "EUR",
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
				{formatPrice(originalPrice, currency)}
			</span>
		);
	}

	return (
		<span className={cn("inline-flex items-baseline gap-2", className)}>
			<span className={cn("text-foreground", mainSize)}>
				{formatPrice(discountedPrice, currency)}
			</span>
			<span className={cn("text-muted-foreground line-through", strikeSize)}>
				{formatPrice(originalPrice, currency)}
			</span>
			<Badge variant="secondary" className="text-xs">
				-{percent}%
			</Badge>
		</span>
	);
}
