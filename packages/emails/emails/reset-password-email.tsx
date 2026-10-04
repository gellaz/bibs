import { Body, Html, Link, Text } from "react-email";
import { greeting } from "../src/greeting";

export interface ResetPasswordEmailProps {
	/** Nome dal profilo; senza, il saluto è neutro. */
	firstName?: string | null;
	resetUrl: string;
}

export default function ResetPasswordEmail({
	firstName,
	resetUrl,
}: ResetPasswordEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>{greeting(firstName)}</Text>
				<Text>
					Abbiamo ricevuto una richiesta di reimpostazione della password.
					Clicca sul link per sceglierne una nuova:
				</Text>
				<Text>
					<Link href={resetUrl}>{resetUrl}</Link>
				</Text>
				<Text>
					Se non hai richiesto tu il reset puoi ignorare questa email. Il link
					scade tra un'ora.
				</Text>
			</Body>
		</Html>
	);
}

ResetPasswordEmail.PreviewProps = {
	firstName: "Mario",
	resetUrl: "http://localhost:3000/auth/api/reset-password/esempio",
} satisfies ResetPasswordEmailProps;
