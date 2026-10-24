import { Body, Html, Text } from "react-email";
import { greeting } from "../src/greeting";

export interface SellerApplicationReceivedEmailProps {
	firstName: string | null;
}

export default function SellerApplicationReceivedEmail({
	firstName,
}: SellerApplicationReceivedEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>{greeting(firstName)}</Text>
				<Text>
					abbiamo ricevuto la tua candidatura come venditore su bibs: adesso
					controlliamo i tuoi dati e il documento d'identità.
				</Text>
				<Text>
					Ti scriviamo appena l'abbiamo valutata, non devi fare altro.
				</Text>
			</Body>
		</Html>
	);
}

SellerApplicationReceivedEmail.PreviewProps = {
	firstName: "Mario",
} satisfies SellerApplicationReceivedEmailProps;
