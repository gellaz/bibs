import { render } from "react-email";
import EmployeeInviteEmail, {
	type EmployeeInviteEmailProps,
} from "../emails/employee-invite-email";
import PaymentFailedEmail, {
	type PaymentFailedEmailProps,
} from "../emails/payment-failed-email";
import ResetPasswordEmail, {
	type ResetPasswordEmailProps,
} from "../emails/reset-password-email";
import SellerApplicationReceivedEmail, {
	type SellerApplicationReceivedEmailProps,
} from "../emails/seller-application-received-email";
import SellerApprovedEmail, {
	type SellerApprovedEmailProps,
} from "../emails/seller-approved-email";
import SellerRejectedEmail, {
	type SellerRejectedEmailProps,
} from "../emails/seller-rejected-email";
import StoreCanceledEmail, {
	type StoreCanceledEmailProps,
} from "../emails/store-canceled-email";
import StoreSuspendedEmail, {
	type StoreSuspendedEmailProps,
} from "../emails/store-suspended-email";
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

/** Email di reimpostazione password. */
export async function renderResetPasswordEmail(
	props: ResetPasswordEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: "Reimposta la tua password su bibs",
		html: await render(<ResetPasswordEmail {...props} />),
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

/** Dunning: primo addebito non riuscito dell'abbonamento di un negozio. */
export async function renderPaymentFailedEmail(
	props: PaymentFailedEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: `Pagamento non riuscito per ${props.storeName}`,
		html: await render(<PaymentFailedEmail {...props} />),
	};
}

/** Dunning: negozio sospeso (non più visibile ai clienti) per insolvenza. */
export async function renderStoreSuspendedEmail(
	props: StoreSuspendedEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: `${props.storeName} è sospeso su bibs`,
		html: await render(<StoreSuspendedEmail {...props} />),
	};
}

/** Abbonamento terminato: negozio archiviato, riattivabile dall'archivio. */
export async function renderStoreCanceledEmail(
	props: StoreCanceledEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: `${props.storeName} è stato archiviato`,
		html: await render(<StoreCanceledEmail {...props} />),
	};
}

/** Onboarding: candidatura completata (o reinviata), in attesa di revisione. */
export async function renderSellerApplicationReceivedEmail(
	props: SellerApplicationReceivedEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: "Abbiamo ricevuto la tua candidatura su bibs",
		html: await render(<SellerApplicationReceivedEmail {...props} />),
	};
}

/** Onboarding: candidatura approvata dall'admin. */
export async function renderSellerApprovedEmail(
	props: SellerApprovedEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: "Il tuo account venditore su bibs è attivo",
		html: await render(<SellerApprovedEmail {...props} />),
	};
}

/** Onboarding: candidatura respinta, da correggere (`fix`) o definitivamente. */
export async function renderSellerRejectedEmail(
	props: SellerRejectedEmailProps,
): Promise<RenderedEmail> {
	return {
		subject: props.fix
			? "La tua candidatura su bibs va corretta"
			: "La tua candidatura su bibs non è stata approvata",
		html: await render(<SellerRejectedEmail {...props} />),
	};
}

export type {
	EmployeeInviteEmailProps,
	PaymentFailedEmailProps,
	ResetPasswordEmailProps,
	SellerApplicationReceivedEmailProps,
	SellerApprovedEmailProps,
	SellerRejectedEmailProps,
	StoreCanceledEmailProps,
	StoreSuspendedEmailProps,
	VerificationEmailProps,
};
