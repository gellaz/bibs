import { Badge } from "@bibs/ui/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@bibs/ui/components/tooltip";
import { formatPriceEur, Price, scorporoDisplay } from "@bibs/ui/custom/price";
import { m } from "@/paraglide/messages";

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
							<button
								type="button"
								className="inline-flex cursor-help rounded-md focus-visible:focus-ring"
							>
								<Badge variant="secondary">-{appliedDiscount.percent}%</Badge>
							</button>
						</TooltipTrigger>
						<TooltipContent>{appliedDiscount.title}</TooltipContent>
					</Tooltip>
				</span>
			) : (
				<Price value={price} />
			)}
			<span className="text-muted-foreground text-xs tabular-nums">
				{m.products_price_net({ net: formatPriceEur(net) })}
			</span>
		</div>
	);
}
