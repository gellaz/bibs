import { Body, Html, Link, Text } from "react-email";
import { greeting } from "../src/greeting";

export interface SellerRejectedEmailProps {
	firstName: string | null;
	/** Scritto o scelto dall'admin, mostrato così com'è. */
	reason: string;
	/** null = rifiuto definitivo, niente da correggere. */
	fix: { step: "document" | "company"; url: string } | null;
	supportEmail: string;
}

export default function SellerRejectedEmail({
	firstName,
	reason,
	fix,
	supportEmail,
}: SellerRejectedEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>{greeting(firstName)}</Text>
				<Text>
					{fix
						? "abbiamo controllato la tua candidatura e c'è qualcosa da correggere."
						: "abbiamo controllato la tua candidatura e purtroppo non possiamo approvarla."}
				</Text>
				<Text>
					Motivo: <strong>{reason}</strong>
				</Text>
				{fix && (
					<>
						<Text>
							{fix.step === "document"
								? "Carica di nuovo il documento d'identità: gli altri dati restano salvati."
								: "Inserisci di nuovo i dati aziendali."}
						</Text>
						<Text>Correggi e reinvia da qui:</Text>
						<Text>
							<Link href={fix.url}>{fix.url}</Link>
						</Text>
					</>
				)}
				<Text>
					Per qualsiasi domanda scrivici a{" "}
					<Link href={`mailto:${supportEmail}`}>{supportEmail}</Link>.
				</Text>
			</Body>
		</Html>
	);
}

SellerRejectedEmail.PreviewProps = {
	firstName: "Mario",
	reason: "Documento illeggibile",
	fix: { step: "document", url: "http://localhost:3002/onboarding/document" },
	supportEmail: "supporto@bibs.it",
} satisfies SellerRejectedEmailProps;
