import { Elysia } from "elysia";
import { ok } from "@/lib/responses";
import { CustomerProfileSchema, okRes, withErrors } from "@/lib/schemas";
import { withCustomer } from "../context";

export const profileRoutes = new Elysia().get(
	"/profile",
	async (ctx) => {
		const { customerProfile: profile } = withCustomer(ctx);
		return ok(profile);
	},
	{
		response: withErrors({ 200: okRes(CustomerProfileSchema) }),
		detail: {
			summary: "Profilo cliente",
			description:
				"Restituisce il profilo del cliente autenticato (punti fedeltà, ecc.). I dati anagrafici sono gestiti tramite better-auth.",
			tags: ["Customer - Profile"],
		},
	},
);
