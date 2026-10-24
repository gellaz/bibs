import { Body, Html, Link, Text } from "react-email";
import { greeting } from "../src/greeting";

export interface SellerApprovedEmailProps {
	firstName: string | null;
	sellerUrl: string;
}

export default function SellerApprovedEmail({
	firstName,
	sellerUrl,
}: SellerApprovedEmailProps) {
	return (
		<Html lang="it">
			<Body lang="it">
				<Text>{greeting(firstName)}</Text>
				<Text>
					la tua candidatura è stata approvata: da adesso puoi vendere su bibs.
				</Text>
				<Text>Entra e crea il tuo primo negozio:</Text>
				<Text>
					<Link href={sellerUrl}>{sellerUrl}</Link>
				</Text>
			</Body>
		</Html>
	);
}

SellerApprovedEmail.PreviewProps = {
	firstName: "Mario",
	sellerUrl: "http://localhost:3002/",
} satisfies SellerApprovedEmailProps;
