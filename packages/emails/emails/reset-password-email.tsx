import { Body, Html, Link, Text } from "react-email";

export interface ResetPasswordEmailProps {
	name: string;
	resetUrl: string;
}

export default function ResetPasswordEmail({
	name,
	resetUrl,
}: ResetPasswordEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>Ciao {name},</Text>
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
	name: "Mario Rossi",
	resetUrl: "http://localhost:3000/auth/api/reset-password/esempio",
} satisfies ResetPasswordEmailProps;
