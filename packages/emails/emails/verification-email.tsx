import { Body, Html, Link, Text } from "react-email";

export interface VerificationEmailProps {
	name: string;
	verifyUrl: string;
}

export default function VerificationEmail({
	name,
	verifyUrl,
}: VerificationEmailProps) {
	return (
		<Html lang="it">
			<Body>
				<Text>Ciao {name},</Text>
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
	name: "Mario Rossi",
	verifyUrl: "http://localhost:3000/auth/api/verify-email?token=esempio",
} satisfies VerificationEmailProps;
