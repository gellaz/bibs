import { Body, Html, Text } from "react-email";
import { greeting } from "../src/greeting";

export interface SellerChangeOutcomeEmailProps {
	firstName: string | null;
	changeType: "vat" | "document";
	approved: boolean;
	/** Motivo scritto dall'admin, mostrato nel rifiuto così com'è. */
	reason: string | null;
}

const WHAT = {
	vat: "della partita IVA",
	document: "del documento d'identità",
} as const;

export default function SellerChangeOutcomeEmail({
	firstName,
	changeType,
	approved,
	reason,
}: SellerChangeOutcomeEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>{greeting(firstName)}</Text>
				<Text>
					{approved
						? `abbiamo approvato la modifica ${WHAT[changeType]}.`
						: `purtroppo non possiamo approvare la modifica ${WHAT[changeType]}.`}
				</Text>
				{changeType === "vat" && (
					<Text>I tuoi negozi tornano a ricevere ordini.</Text>
				)}
				{!approved && reason && (
					<Text>
						Motivo: <strong style={{ whiteSpace: "pre-line" }}>{reason}</strong>
					</Text>
				)}
			</Body>
		</Html>
	);
}

SellerChangeOutcomeEmail.PreviewProps = {
	firstName: "Mario",
	changeType: "vat",
	approved: false,
	reason: "Numero non valido",
} satisfies SellerChangeOutcomeEmailProps;
