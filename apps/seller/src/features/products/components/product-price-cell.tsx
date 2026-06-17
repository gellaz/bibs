import { Badge } from "@bibs/ui/components/badge";
import {
	formatPriceEur,
	Price,
	scorporoDisplay,
} from "@bibs/ui/components/price";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@bibs/ui/components/tooltip";

interface AppliedDiscount {
	percent: number;
	discountedPrice: string;
	title: string;
}

interface Props {
	price: string;
	vatRate: string;
	appliedDiscount: AppliedDiscount | null;
}

export function ProductPriceCell({ price, vatRate, appliedDiscount }: Props) {
	// VAT base is the actually-charged price: the discounted one when a promo is
	// active (matches checkout, which discounts before scorporo).
	const effectivePrice = appliedDiscount?.discountedPrice ?? price;
	const { net } = scorporoDisplay(effectivePrice, Number(vatRate));

	return (
		<div className="flex flex-col leading-tight">
			{appliedDiscount ? (
				<span className="flex items-center gap-1.5">
					<Price
						value={appliedDiscount.discountedPrice}
						className="font-semibold"
					/>
					<span className="text-muted-foreground text-xs tabular-nums line-through">
						{formatPriceEur(price)}
					</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<button type="button" className="inline-flex">
								<Badge variant="secondary">−{appliedDiscount.percent}%</Badge>
							</button>
						</TooltipTrigger>
						<TooltipContent>{appliedDiscount.title}</TooltipContent>
					</Tooltip>
				</span>
			) : (
				<Price value={price} />
			)}
			<span className="text-muted-foreground text-xs tabular-nums">
				netto {formatPriceEur(net)}
			</span>
		</div>
	);
}
