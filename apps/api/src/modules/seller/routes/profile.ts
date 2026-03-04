import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok } from "@/lib/responses";
import { okRes, SellerProfileSchema, withErrors } from "@/lib/schemas";
import { withSellerAuth } from "../context";
import { getSellerProfile, updateSellerVat } from "../services/profile";

export const profileRoutes = new Elysia()
	.get(
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
	)
	.patch(
		"/profile/vat",
		async (ctx) => {
			const { body, user, store } = withSellerAuth(ctx);
			const pino = getLogger(store);
			const updated = await updateSellerVat({
				userId: user.id,
				vatNumber: body.vatNumber,
			});

			pino.info(
				{
					userId: user.id,
					newVatNumber: body.vatNumber,
					action: "update_seller_vat",
				},
				"Seller VAT number updated and reset to pending",
			);

			return ok(updated);
		},
		{
			body: t.Object({
				vatNumber: t.String({
					pattern: "^[0-9]{11}$",
					description: "Partita IVA italiana (11 cifre)",
				}),
			}),
			response: withErrors({ 200: okRes(SellerProfileSchema) }),
			detail: {
				summary: "Aggiorna partita IVA",
				description:
					"Permette ai venditori con partita IVA rifiutata di inviare una nuova partita IVA. Lo stato viene reimpostato a 'pending'.",
				tags: ["Seller - Profile"],
			},
		},
	);
