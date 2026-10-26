import { Hono } from "hono";
import { requireCustomer } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { ok } from "@/lib/responses";
import { CustomerProfileSchema } from "@/lib/schemas/entities";
import { okRes, withErrors } from "@/lib/schemas/responses";
import { customerSecurity } from "../context";

const ProfileResponse = okRes(CustomerProfileSchema);

export const profileRoutes = new Hono().get(
	"/profile",
	doc({
		response: withErrors({ 200: ProfileResponse }),
		detail: {
			summary: "Profilo cliente",
			description:
				"Restituisce il profilo del cliente autenticato (punti fedeltà, ecc.). I dati anagrafici sono gestiti tramite better-auth.",
			tags: ["Customer - Profile"],
			...customerSecurity,
		},
	}),
	requireCustomer,
	(c) => send(c, ProfileResponse, ok(c.var.customerProfile)),
);
