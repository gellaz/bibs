import { Hono } from "hono";
import { requireSellerRole } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { logger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import { SellerProfileSchema } from "@/lib/zod/entities";
import { okRes, withErrors } from "@/lib/zod/responses";
import { getSellerProfile } from "../services/profile";

const ProfileRes = okRes(SellerProfileSchema);

export const profileRoutes = new Hono().get(
	"/profile",
	doc({
		response: withErrors({ 200: ProfileRes }),
		detail: {
			summary: "Profilo venditore",
			description:
				"Restituisce il profilo del venditore autenticato, incluso lo stato di verifica della partita IVA. Non richiede che la partita IVA sia già verificata.",
			tags: ["Seller - Profile"],
			security: [{ bearerAuth: [] }],
		},
	}),
	requireSellerRole,
	async (c) => {
		const user = c.var.user;
		const profile = await getSellerProfile(user.id);

		logger.info(
			{
				userId: user.id,
				onboardingStatus: profile.onboardingStatus,
				action: "get_seller_profile",
			},
			"Seller profile retrieved",
		);

		return send(c, ProfileRes, ok(profile));
	},
);
