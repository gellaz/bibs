import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import { registerCustomer, registerSeller, signIn } from "./services";

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
				name: t.String({ description: "Nome completo dell'utente" }),
				email: t.String({ format: "email", description: "Indirizzo email" }),
				password: t.String({
					minLength: 8,
					description: "Password (minimo 8 caratteri)",
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
					vatNumber: body.vatNumber,
					action: "seller_registration",
				},
				"Nuovo venditore registrato (in attesa di verifica)",
			);

			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({ description: "Nome completo dell'utente" }),
				email: t.String({ format: "email", description: "Indirizzo email" }),
				password: t.String({
					minLength: 8,
					description: "Password (minimo 8 caratteri)",
				}),
				vatNumber: t.String({
					pattern: "^[0-9]{11}$",
					description: "Partita IVA italiana (11 cifre)",
				}),
			}),
			detail: {
				summary: "Registrazione venditore",
				description:
					"Crea un nuovo account venditore con profilo e partita IVA in stato 'pending'. Richiede verifica da parte di un admin.",
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
