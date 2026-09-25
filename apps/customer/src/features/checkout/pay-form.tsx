import { Button } from "@bibs/ui/components/button";
import { formatPriceEur } from "@bibs/ui/components/price";
import {
	Elements,
	PaymentElement,
	useElements,
	useStripe,
} from "@stripe/react-stripe-js";
import { type FormEvent, useState } from "react";
import { m } from "@/paraglide/messages";
import { getStripe } from "./stripe";

interface Props {
	clientSecret: string;
	amount: string;
	returnUrl: string;
	/** Pagamento riuscito senza redirect: si va alla pagina di ordine effettuato. */
	onPaid: () => void;
	/** Il PI non è più pagabile (scaduto o già pagato): rileggere lo stato. */
	onStale: () => void;
}

/** Caricato con lazy() solo lato client: Stripe.js tocca window. */
export default function PayForm({ clientSecret, ...rest }: Props) {
	const dark = document.documentElement.classList.contains("dark");
	return (
		<Elements
			stripe={getStripe()}
			options={{
				clientSecret,
				locale: "it",
				appearance: { theme: dark ? "night" : "stripe" },
			}}
		>
			<Inner {...rest} />
		</Elements>
	);
}

function Inner({
	amount,
	returnUrl,
	onPaid,
	onStale,
}: Omit<Props, "clientSecret">) {
	const stripe = useStripe();
	const elements = useElements();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!stripe || !elements) return;
		setBusy(true);
		setError(null);
		// 3DS e wallet con redirect tornano su returnUrl; le carte senza
		// autenticazione restano qui.
		const result = await stripe.confirmPayment({
			elements,
			confirmParams: { return_url: returnUrl },
			redirect: "if_required",
		});
		setBusy(false);
		if (result.error) {
			if (result.error.code === "payment_intent_unexpected_state")
				return onStale();
			return setError(result.error.message ?? m.checkout_pay_failed_generic());
		}
		const status = result.paymentIntent?.status;
		if (status === "succeeded" || status === "processing") onPaid();
	};

	return (
		<form onSubmit={submit} className="space-y-4">
			<PaymentElement />
			{error && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			<Button
				type="submit"
				size="lg"
				className="min-h-11 w-full"
				disabled={!stripe || !elements || busy}
			>
				{m.checkout_pay_submit({ amount: formatPriceEur(amount) })}
			</Button>
		</form>
	);
}
