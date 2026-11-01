import { Hono } from "hono";
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
} from "@/schemas/composed";
import { AcceptInviteBody } from "@/schemas/forms/onboarding";
import { RegisterBody } from "@/schemas/registration";
import {
	OkMessage,
	okRes,
	TooManyRequestsError,
	withConflictErrors,
} from "@/schemas/responses";
import {
	acceptInvite,
	registerCustomer,
	registerSeller,
} from "../services/registration";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RegisterCustomerResponse = okRes(RegisterCustomerResult);
export const RegisterSellerResponse = okRes(RegisterSellerResult);

export const registrationRoutes = new Hono()
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
	);
