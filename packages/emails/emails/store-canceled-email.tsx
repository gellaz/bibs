import { Body, Html, Link, Text } from "react-email";

export interface StoreCanceledEmailProps {
	ownerName: string;
	storeName: string;
	/**
	 * payment_failed: archiviato in automatico per mancato pagamento.
	 * seller_canceled: il titolare ha chiesto la cancellazione.
	 */
	reason: "payment_failed" | "seller_canceled";
	archivedUrl: string;
}

export default function StoreCanceledEmail({
	ownerName,
	storeName,
	reason,
	archivedUrl,
}: StoreCanceledEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>Ciao {ownerName},</Text>
				{reason === "payment_failed" ? (
					<Text>
						il negozio <strong>{storeName}</strong> è stato archiviato per
						mancato pagamento dell'abbonamento. Non è più visibile ai clienti e
						non ti verrà addebitato altro.
					</Text>
				) : (
					<Text>
						come hai richiesto, l'abbonamento del negozio{" "}
						<strong>{storeName}</strong> è terminato e il negozio è stato
						archiviato. Non è più visibile ai clienti e non ti verrà addebitato
						altro.
					</Text>
				)}
				<Text>
					Prodotti, giacenze, orari e immagini restano salvati. Puoi riattivare
					il negozio quando vuoi dalla pagina «Negozi archiviati», con il
					pulsante «Riattiva»: dopo il pagamento del nuovo abbonamento torna
					online com'era.
				</Text>
				<Text>
					<Link href={archivedUrl}>{archivedUrl}</Link>
				</Text>
			</Body>
		</Html>
	);
}

StoreCanceledEmail.PreviewProps = {
	ownerName: "Mario Rossi",
	storeName: "Forno Bianchi",
	reason: "payment_failed",
	archivedUrl: "http://localhost:3002/store/archived",
} satisfies StoreCanceledEmailProps;
