import { Body, Html, Link, Text } from "react-email";

export interface EmployeeInviteEmailProps {
	businessName: string;
	inviteUrl: string;
	expiryDays: number;
}

export default function EmployeeInviteEmail({
	businessName,
	inviteUrl,
	expiryDays,
}: EmployeeInviteEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>Ciao,</Text>
				<Text>
					<strong>{businessName}</strong> ti ha invitato a collaborare come
					membro del team su bibs.
				</Text>
				<Text>
					Clicca sul link seguente per creare la tua password e accedere:
				</Text>
				<Text>
					<Link href={inviteUrl}>{inviteUrl}</Link>
				</Text>
				<Text>Il link scade tra {expiryDays} giorni.</Text>
				<Text>
					Se non conosci {businessName} o non ti aspettavi questo invito, puoi
					ignorare questa email.
				</Text>
			</Body>
		</Html>
	);
}

// Props mostrate dal preview server (`bun run dev:emails`)
EmployeeInviteEmail.PreviewProps = {
	businessName: "Libreria Esempio",
	inviteUrl: "http://localhost:3002/invite/esempio-token",
	expiryDays: 7,
} satisfies EmployeeInviteEmailProps;
