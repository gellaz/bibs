import { Body, Html, Link, Text } from "react-email";

export interface AdminNewRequestEmailProps {
	kind: "candidature" | "vat" | "document";
	sellerName: string;
	requestUrl: string;
}

const WHAT = {
	candidature: "una nuova candidatura come venditore",
	vat: "una richiesta di cambio partita IVA",
	document: "una richiesta di cambio documento d'identità",
} as const;

export default function AdminNewRequestEmail({
	kind,
	sellerName,
	requestUrl,
}: AdminNewRequestEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>Ciao,</Text>
				<Text>
					{sellerName} ha inviato {WHAT[kind]}.
				</Text>
				<Text>Puoi valutarla da qui:</Text>
				<Text>
					<Link href={requestUrl}>{requestUrl}</Link>
				</Text>
			</Body>
		</Html>
	);
}

AdminNewRequestEmail.PreviewProps = {
	kind: "vat",
	sellerName: "Mario Rossi",
	requestUrl: "http://localhost:3003/requests",
} satisfies AdminNewRequestEmailProps;
