import { render } from "react-email";
import EmployeeInviteEmail, {
	type EmployeeInviteEmailProps,
} from "../emails/employee-invite-email";
import VerificationEmail, {
	type VerificationEmailProps,
} from "../emails/verification-email";

export interface RenderedEmail {
	subject: string;
	html: string;
}

/** Email di verifica indirizzo inviata alla registrazione (customer e seller). */
export async function renderVerificationEmail(
	props: VerificationEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: "Verifica la tua email su bibs",
		html: await render(<VerificationEmail {...props} />),
	};
}

/** Invito di un dipendente a unirsi al team di un venditore. */
export async function renderEmployeeInviteEmail(
	props: EmployeeInviteEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: `${props.businessName} ti ha invitato a collaborare su bibs`,
		html: await render(<EmployeeInviteEmail {...props} />),
	};
}

export type { EmployeeInviteEmailProps, VerificationEmailProps };
