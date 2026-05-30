import { Elysia, t } from "elysia";
import { ServiceError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	OkMessage,
	okRes,
	RegisterCustomerResult,
	RegisterSellerResult,
	SignInResult,
	TooManyRequestsError,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { AcceptInviteBody } from "@/lib/schemas/forms";
import { rateLimit } from "@/plugins/rate-limit";
import {
	acceptInvite,
	registerCustomer,
	registerSeller,
	signIn,
} from "./services";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const registration = new Elysia({
	prefix: "/register",
	tags: ["Registration"],
})
	.post(
		"/customer",
		async ({ body, store }) => {
			const pino = getLogger(store);
			const data = await registerCustomer(body, pino);

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
			beforeHandle: rateLimit({
				name: "register-customer",
				limits: [
					{ by: "ip", window: HOUR, max: 10 },
					// Bound verification-email resends per target address, even if the
					// source IP rotates.
					{ by: "email", window: HOUR, max: 3 },
				],
			}),
			response: withConflictErrors({
				200: okRes(RegisterCustomerResult),
				429: TooManyRequestsError,
			}),
			detail: {
				summary: "Registrazione cliente",
				description:
					"Crea un nuovo account cliente con profilo e saldo punti inizializzato a zero. Errori 409: `EMAIL_ALREADY_REGISTERED` se l'email è già verificata; `EMAIL_PENDING_VERIFICATION` se l'email esiste ma è in attesa di verifica (entro 7gg) — il backend re-invia il link automaticamente e il body contiene `resentAt`.",
			},
		},
	)
	.post(
		"/seller",
		async ({ body, store }) => {
			const pino = getLogger(store);
			const data = await registerSeller(body, pino);

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
			beforeHandle: rateLimit({
				name: "register-seller",
				limits: [
					{ by: "ip", window: HOUR, max: 10 },
					{ by: "email", window: HOUR, max: 3 },
				],
			}),
			response: withConflictErrors({
				200: okRes(RegisterSellerResult),
				429: TooManyRequestsError,
			}),
			detail: {
				summary: "Registrazione venditore",
				description:
					"Crea un nuovo account venditore. Dopo la verifica email, il venditore dovrà completare l'onboarding (dati personali, documento, azienda, negozio, pagamento). Errori 409: `EMAIL_ALREADY_REGISTERED` se l'email è già verificata; `EMAIL_PENDING_VERIFICATION` se l'email esiste ma è in attesa di verifica (entro 7gg) — il backend re-invia il link automaticamente e il body contiene `resentAt`.",
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

			const result = await acceptInvite(
				{
					token: body.token,
					password: body.password,
				},
				pino,
			);

			pino.info(
				{ token: body.token, action: "employee_invite_accepted" },
				"Employee accepted invitation",
			);

			return okMessage(result.message);
		},
		{
			beforeHandle: rateLimit({
				name: "accept-invite",
				limits: [{ by: "ip", window: HOUR, max: 20 }],
			}),
			body: AcceptInviteBody,
			response: withConflictErrors({
				200: OkMessage,
				429: TooManyRequestsError,
			}),
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
			beforeHandle: rateLimit({
				name: "sign-in",
				limits: [
					{ by: "ip", window: 15 * MINUTE, max: 30 },
					{ by: "email", window: 15 * MINUTE, max: 10 },
				],
			}),
			body: t.Object({
				email: t.String({ format: "email", description: "Indirizzo email" }),
				password: t.String({ description: "Password" }),
			}),
			response: withErrors({
				200: okRes(SignInResult),
				429: TooManyRequestsError,
			}),
			detail: {
				summary: "Login",
				description:
					"Autentica un utente e restituisce i dati utente, entrambi i profili (customer e seller se esistenti) e token di sessione. Il campo 'role' indica il ruolo primario.",
				tags: ["Auth"],
			},
		},
	);
