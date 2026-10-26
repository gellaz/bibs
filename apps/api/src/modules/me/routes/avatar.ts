import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { okMessage } from "@/lib/responses";
import { OkMessage, okRes, withErrors } from "@/lib/schemas/responses";
import { zFile } from "@/lib/schemas/t";
import { deleteUserAvatar, uploadUserAvatar } from "../services/avatar";

export const AvatarResponse = okRes(
	z.object({
		image: z
			.string()
			.meta({ description: "URL pubblica della nuova immagine profilo" }),
	}),
);

export const AvatarBody = z.object({
	file: zFile({
		type: "image",
		maxSize: "5m",
		description: "Immagine (max 5MB, formati image/*)",
	}),
});

// Route relative: il modulo è montato su /me (`src/app.ts`).
export const avatarRoutes = new Hono()
	.post(
		"/avatar",
		doc({
			response: withErrors({ 200: AvatarResponse }),
			detail: {
				summary: "Carica immagine profilo",
				description:
					"Carica un'immagine per l'utente corrente. Il file viene ridimensionato a 512x512 JPEG e salvato su S3. La URL viene scritta su `user.image`.",
				tags: ["Me"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("form", AvatarBody),
		requireAuth,
		async (c) => {
			const user = c.var.user;
			const result = await uploadUserAvatar({
				userId: user.id,
				file: c.req.valid("form").file,
			});
			logger.info(
				{ userId: user.id, action: "user_avatar_uploaded", key: result.key },
				"Immagine profilo aggiornata",
			);
			return send(c, AvatarResponse, {
				success: true,
				data: { image: result.url },
			});
		},
	)
	.delete(
		"/avatar",
		doc({
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi immagine profilo",
				description:
					"Setta `user.image` a NULL e cancella il file da S3 (best-effort). No-op se l'utente non ha un'immagine.",
				tags: ["Me"],
				security: [{ bearerAuth: [] }],
			},
		}),
		requireAuth,
		async (c) => {
			const user = c.var.user;
			await deleteUserAvatar({ userId: user.id });
			logger.info(
				{ userId: user.id, action: "user_avatar_deleted" },
				"Immagine profilo rimossa",
			);
			return send(c, OkMessage, okMessage("Avatar rimosso"));
		},
	);
