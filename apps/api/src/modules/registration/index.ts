import { Elysia, t } from "elysia";
import { ServiceError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import { OkMessage, withConflictErrors } from "@/lib/schemas";
import { AcceptInviteBody } from "@/lib/schemas/forms";
import {
	acceptInvite,
	registerCustomer,
	registerSeller,
	signIn,
} from "./services";

export const registration = new Elysia({
	prefix: "/register",
	tags: ["Registration"],
})
	.post(
		"/customer",
		async ({ body, store }) => {
			const pino = getLogger(store);
			const data = await registerCustomer(body);

			pino.info(
				{
					userId: data.user.id,
					email: data.user.email,
					action: "customer_registration",
				},
				"Nuovo cliente registrato",
			);

			return ok(data);
		},
		{
			body: t.Object({
				email: t.String({ format: "email", description: "Indirizzo email" }),
				password: t.String({
					minLength: 8,
					maxLength: 128,
					description: "Password (minimo 8, massimo 128 caratteri)",
				}),
			}),
			detail: {
				summary: "Registrazione cliente",
				description:
					"Crea un nuovo account cliente con profilo e saldo punti inizializzato a zero.",
			},
		},
	)
	.post(
		"/seller",
		async ({ body, store }) => {
			const pino = getLogger(store);
			const data = await registerSeller(body);

			pino.info(
				{
					userId: data.user.id,
					email: data.user.email,
					action: "seller_registration",
				},
				"Nuovo venditore registrato (onboarding in corso)",
			);

			return ok(data);
		},
		{
			body: t.Object({
				email: t.String({ format: "email", description: "Indirizzo email" }),
				password: t.String({
					minLength: 8,
					maxLength: 128,
					description: "Password (minimo 8, massimo 128 caratteri)",
				}),
			}),
			detail: {
				summary: "Registrazione venditore",
				description:
					"Crea un nuovo account venditore. Dopo la verifica email, il venditore dovrà completare l'onboarding (dati personali, documento, azienda, negozio, pagamento).",
			},
		},
	)
	.post(
		"/accept-invite",
		async ({ body, store }) => {
			const pino = getLogger(store);

			if (body.password !== body.confirmPassword) {
				throw new ServiceError(400, "Le password non coincidono");
			}

			const result = await acceptInvite({
				token: body.token,
				password: body.password,
			});

			pino.info(
				{ token: body.token, action: "employee_invite_accepted" },
				"Employee accepted invitation",
			);

			return okMessage(result.message);
		},
		{
			body: AcceptInviteBody,
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Accetta invito dipendente",
				description:
					"Accetta un invito di collaborazione. Crea l'account dipendente con la password fornita. Non richiede autenticazione.",
			},
		},
	)
	.post(
		"/sign-in",
		async ({ body, store }) => {
			const pino = getLogger(store);
			const data = await signIn(body);

			pino.info(
				{
					userId: data.user.id,
					email: data.user.email,
					role: data.user.role,
					hasCustomerProfile: !!data.profiles.customer,
					hasSellerProfile: !!data.profiles.seller,
					action: "user_sign_in",
				},
				"Utente autenticato",
			);

			return ok(data);
		},
		{
			body: t.Object({
				email: t.String({ format: "email", description: "Indirizzo email" }),
				password: t.String({ description: "Password" }),
			}),
			detail: {
				summary: "Login",
				description:
					"Autentica un utente e restituisce i dati utente, entrambi i profili (customer e seller se esistenti) e token di sessione. Il campo 'role' indica il ruolo primario.",
				tags: ["Auth"],
			},
		},
	);
