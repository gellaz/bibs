import { Body, Html, Link, Text } from "react-email";

export interface PaymentFailedEmailProps {
	ownerName: string;
	storeName: string;
	/** Importo della fattura non pagata, in centesimi. */
	amountCents: number;
	/** Codice ISO 4217 (es. "EUR"). */
	currency: string;
	billingUrl: string;
}

function formatAmount(cents: number, currency: string): string {
	return new Intl.NumberFormat("it-IT", {
		style: "currency",
		currency: currency.toUpperCase(),
	}).format(cents / 100);
}

export default function PaymentFailedEmail({
	ownerName,
	storeName,
	amountCents,
	currency,
	billingUrl,
}: PaymentFailedEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>Ciao {ownerName},</Text>
				<Text>
					non siamo riusciti ad addebitare{" "}
					<strong>{formatAmount(amountCents, currency)}</strong> per
					l'abbonamento del negozio <strong>{storeName}</strong>.
				</Text>
				<Text>
					Il negozio per ora resta visibile ai clienti. Riproveremo l'addebito
					nei prossimi giorni: se continua a non andare a buon fine il negozio
					verrà sospeso.
				</Text>
				<Text>
					Per evitarlo aggiorna il metodo di pagamento dalla pagina Billing, con
					il pulsante «Gestisci pagamenti su Stripe»:
				</Text>
				<Text>
					<Link href={billingUrl}>{billingUrl}</Link>
				</Text>
			</Body>
		</Html>
	);
}

PaymentFailedEmail.PreviewProps = {
	ownerName: "Mario Rossi",
	storeName: "Forno Bianchi",
	amountCents: 2900,
	currency: "EUR",
	billingUrl: "http://localhost:3002/billing",
} satisfies PaymentFailedEmailProps;
