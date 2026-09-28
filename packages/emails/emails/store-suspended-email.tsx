import { Body, Html, Link, Text } from "react-email";

export interface StoreSuspendedEmailProps {
	ownerName: string;
	storeName: string;
	billingUrl: string;
}

export default function StoreSuspendedEmail({
	ownerName,
	storeName,
	billingUrl,
}: StoreSuspendedEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>Ciao {ownerName},</Text>
				<Text>
					dopo diversi tentativi di addebito non riusciti, il negozio{" "}
					<strong>{storeName}</strong> è stato sospeso: da adesso non è più
					visibile ai clienti.
				</Text>
				<Text>
					Prodotti, orari e immagini restano salvati. Appena il pagamento va a
					buon fine il negozio torna visibile da solo.
				</Text>
				<Text>
					Aggiorna il metodo di pagamento dalla pagina Billing, con il pulsante
					«Gestisci pagamenti su Stripe»:
				</Text>
				<Text>
					<Link href={billingUrl}>{billingUrl}</Link>
				</Text>
				<Text>Se il pagamento non arriva, il negozio verrà archiviato.</Text>
			</Body>
		</Html>
	);
}

StoreSuspendedEmail.PreviewProps = {
	ownerName: "Mario Rossi",
	storeName: "Forno Bianchi",
	billingUrl: "http://localhost:3002/billing",
} satisfies StoreSuspendedEmailProps;
