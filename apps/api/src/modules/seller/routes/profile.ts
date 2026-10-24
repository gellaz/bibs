import { Elysia } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import { okRes, SellerProfileSchema, withErrors } from "@/lib/schemas";
import { withSellerAuth } from "../context";
import { getSellerProfile } from "../services/profile";

export const profileRoutes = new Elysia().get(
	"/profile",
	async (ctx) => {
		const { user, store } = withSellerAuth(ctx);
		const pino = getLogger(store);
		const profile = await getSellerProfile(user.id);

		pino.info(
			{
				userId: user.id,
				onboardingStatus: profile.onboardingStatus,
				action: "get_seller_profile",
			},
			"Seller profile retrieved",
		);

		return ok(profile);
	},
	{
		response: withErrors({ 200: okRes(SellerProfileSchema) }),
		detail: {
			summary: "Profilo venditore",
			description:
				"Restituisce il profilo del venditore autenticato, incluso lo stato di verifica della partita IVA. Non richiede che la partita IVA sia già verificata.",
			tags: ["Seller - Profile"],
		},
	},
);
