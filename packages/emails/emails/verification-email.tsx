import { Body, Html, Link, Text } from "react-email";
import { greeting } from "../src/greeting";

export interface VerificationEmailProps {
	/** Nome dal profilo; senza, il saluto è neutro. */
	firstName?: string | null;
	verifyUrl: string;
}

export default function VerificationEmail({
	firstName,
	verifyUrl,
}: VerificationEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>{greeting(firstName)}</Text>
				<Text>Clicca sul link per verificare il tuo indirizzo email:</Text>
				<Text>
					<Link href={verifyUrl}>{verifyUrl}</Link>
				</Text>
			</Body>
		</Html>
	);
}

// Props mostrate dal preview server (`bun run dev:emails`)
VerificationEmail.PreviewProps = {
	firstName: "Mario",
	verifyUrl: "http://localhost:3000/auth/api/verify-email?token=esempio",
} satisfies VerificationEmailProps;
