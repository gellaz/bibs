import { moduleApp } from "@/http/app";
import { rateLimit } from "@/http/middleware/rate-limit";
import { doc } from "@/http/openapi";
import { ok, okMessage } from "@/http/responses";
import { publicRoute } from "@/http/routes";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { ServiceError } from "@/lib/errors";
import {
	RegisterCustomerResult,
	RegisterSellerResult,
	SignInResult,
} from "@/schemas/composed";
import { AcceptInviteBody } from "@/schemas/forms/onboarding";
import { RegisterBody, SignInBody } from "@/schemas/registration";
import {
	OkMessage,
	okRes,
	TooManyRequestsError,
	withConflictErrors,
	withErrors,
} from "@/schemas/responses";
import {
	acceptInvite,
	registerCustomer,
	registerSeller,
	signIn,
} from "./services";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RegisterCustomerResponse = okRes(RegisterCustomerResult);
export const RegisterSellerResponse = okRes(RegisterSellerResult);
export const SignInResponse = okRes(SignInResult);

/**
 * Sub-app Hono del modulo, montata su /register in `src/app.ts`: quattro
 * POST pubblici, ognuno col suo rate limit dopo la validazione.
 */
export const registrationApp = moduleApp()
	.post(
		"/customer",
		doc({
			response: withConflictErrors({
				200: RegisterCustomerResponse,
				429: TooManyRequestsError,
			}),
			detail: {
				summary: "Registrazione cliente",
				description:
					"Crea un nuovo account cliente con profilo e saldo punti inizializzato a zero. Errori 409: `EMAIL_ALREADY_REGISTERED` se l'email è già verificata; `EMAIL_PENDING_VERIFICATION` se l'email esiste ma è in attesa di verifica (entro 7gg) — il backend re-invia il link automaticamente e il body contiene `resentAt`.",
				tags: ["Registration"],
			},
		}),
		v("json", RegisterBody),
		publicRoute,
		rateLimit({
			name: "register-customer",
			limits: [
				{ by: "ip", window: HOUR, max: 10 },
				// Bound verification-email resends per target address, even if the
				// source IP rotates.
				{ by: "email", window: HOUR, max: 3 },
			],
		}),
		async (c) => {
			const data = await registerCustomer(c.req.valid("json"), logger);

			logger.info(
				{
					userId: data.user.id,
					email: data.user.email,
					action: "customer_registration",
				},
				"Nuovo cliente registrato",
			);

			return send(c, RegisterCustomerResponse, ok(data));
		},
	)
	.post(
		"/seller",
		doc({
			response: withConflictErrors({
				200: RegisterSellerResponse,
				429: TooManyRequestsError,
			}),
			detail: {
				summary: "Registrazione venditore",
				description:
					"Crea un nuovo account venditore. Dopo la verifica email, il venditore dovrà completare l'onboarding (dati personali, documento, azienda, negozio, pagamento). Errori 409: `EMAIL_ALREADY_REGISTERED` se l'email è già verificata; `EMAIL_PENDING_VERIFICATION` se l'email esiste ma è in attesa di verifica (entro 7gg) — il backend re-invia il link automaticamente e il body contiene `resentAt`.",
				tags: ["Registration"],
			},
		}),
		v("json", RegisterBody),
		publicRoute,
		rateLimit({
			name: "register-seller",
			limits: [
				{ by: "ip", window: HOUR, max: 10 },
				{ by: "email", window: HOUR, max: 3 },
			],
		}),
		async (c) => {
			const data = await registerSeller(c.req.valid("json"), logger);

			logger.info(
				{
					userId: data.user.id,
					email: data.user.email,
					action: "seller_registration",
				},
				"Nuovo venditore registrato (onboarding in corso)",
			);

			return send(c, RegisterSellerResponse, ok(data));
		},
	)
	.post(
		"/accept-invite",
		doc({
			response: withConflictErrors({
				200: OkMessage,
				429: TooManyRequestsError,
			}),
			detail: {
				summary: "Accetta invito dipendente",
				description:
					"Accetta un invito di collaborazione. Crea l'account dipendente con la password fornita. Non richiede autenticazione.",
				tags: ["Registration"],
			},
		}),
		v("json", AcceptInviteBody),
		publicRoute,
		rateLimit({
			name: "accept-invite",
			limits: [{ by: "ip", window: HOUR, max: 20 }],
		}),
		async (c) => {
			const body = c.req.valid("json");

			if (body.password !== body.confirmPassword) {
				throw new ServiceError(400, "Le password non coincidono");
			}

			const result = await acceptInvite(
				{
					token: body.token,
					password: body.password,
				},
				logger,
			);

			logger.info(
				{ token: body.token, action: "employee_invite_accepted" },
				"Employee accepted invitation",
			);

			return send(c, OkMessage, okMessage(result.message));
		},
	)
	.post(
		"/sign-in",
		doc({
			response: withErrors({
				200: SignInResponse,
				429: TooManyRequestsError,
			}),
			detail: {
				summary: "Login",
				description:
					"Autentica un utente e restituisce i dati utente, entrambi i profili (customer e seller se esistenti) e token di sessione. Il campo 'role' indica il ruolo primario.",
				tags: ["Auth"],
			},
		}),
		v("json", SignInBody),
		publicRoute,
		rateLimit({
			name: "sign-in",
			limits: [
				{ by: "ip", window: 15 * MINUTE, max: 30 },
				{ by: "email", window: 15 * MINUTE, max: 10 },
			],
		}),
		async (c) => {
			const data = await signIn(c.req.valid("json"));

			logger.info(
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

			return send(c, SignInResponse, ok(data));
		},
	);

/** Tipo per il client `hc` dei frontend (`hc<RegistrationApp>(`${API_URL}/register`)`). */
export type RegistrationApp = typeof registrationApp;
