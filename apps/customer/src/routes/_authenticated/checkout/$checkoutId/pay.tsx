import { Button } from "@bibs/ui/components/button";
import { formatPriceEur } from "@bibs/ui/components/price";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Navigate,
	useNavigate,
} from "@tanstack/react-router";
import { CreditCard, SearchX } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { NoticePage } from "@/components/notice";
import { getStripe } from "@/features/checkout/stripe";
import { ORDERS_KEY, useCheckout } from "@/features/checkout/use-checkout";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute(
	"/_authenticated/checkout/$checkoutId/pay",
)({
	component: CheckoutPayPage,
});

const LazyPayForm = lazy(() => import("@/features/checkout/pay-form"));
const TIME_FMT: Intl.DateTimeFormatOptions = {
	hour: "2-digit",
	minute: "2-digit",
};

function CheckoutPayPage() {
	const { checkoutId } = Route.useParams();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const { data, isPending, refetch } = useCheckout(checkoutId);
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const goToDone = () => {
		void qc.invalidateQueries({ queryKey: ORDERS_KEY });
		void navigate({
			to: "/checkout/$checkoutId",
			params: { checkoutId },
			replace: true,
		});
	};

	if (isPending)
		return (
			<div className="mx-auto w-full max-w-lg space-y-4 px-4 py-8 sm:px-6">
				<Skeleton className="h-8 w-40" />
				<Skeleton className="h-64 w-full" />
			</div>
		);

	if (!data)
		return (
			<NoticePage
				icon={SearchX}
				title={m.checkout_not_found()}
				description={m.orders_empty_description()}
				action={
					<Button asChild>
						<Link to="/orders" search={{ tab: "paid", page: 1 }}>
							{m.checkout_done_orders_cta()}
						</Link>
					</Button>
				}
			/>
		);

	// Niente da pagare (già pagato, scaduto, solo prenotazioni): lo stato vero
	// lo mostra la pagina di ordine effettuato.
	if (!data.payment)
		return (
			<Navigate to="/checkout/$checkoutId" params={{ checkoutId }} replace />
		);

	if (!getStripe())
		return (
			<NoticePage
				icon={CreditCard}
				title={m.checkout_pay_title()}
				description={m.checkout_pay_unavailable()}
			/>
		);

	const expiresAt = data.orders.find(
		(o) => o.type === "pay_pickup" && o.paymentExpiresAt,
	)?.paymentExpiresAt;

	return (
		<div className="mx-auto w-full max-w-lg space-y-6 px-4 py-8 sm:px-6">
			<h1 className="font-display font-semibold text-2xl text-foreground">
				{m.checkout_pay_title()}
			</h1>
			<div className="flex items-baseline justify-between">
				<span className="font-medium text-foreground">
					{m.checkout_pay_amount()}
				</span>
				<span className="font-semibold text-foreground text-xl tabular-nums">
					{formatPriceEur(data.amountDueOnline)}
				</span>
			</div>
			{expiresAt && (
				<p className="rounded-lg bg-muted p-3 text-foreground text-sm">
					{m.checkout_pay_expires({
						time: new Date(expiresAt).toLocaleTimeString("it-IT", TIME_FMT),
					})}
				</p>
			)}
			{mounted ? (
				<Suspense fallback={<Skeleton className="h-64 w-full" />}>
					<LazyPayForm
						clientSecret={data.payment.clientSecret}
						amount={data.amountDueOnline}
						// Stessa URL senza /pay, prefisso di lingua incluso.
						returnUrl={window.location.href
							.split("?")[0]
							.replace(/\/pay\/?$/, "")}
						onPaid={goToDone}
						onStale={() => void refetch()}
					/>
				</Suspense>
			) : (
				<Skeleton className="h-64 w-full" />
			)}
		</div>
	);
}
