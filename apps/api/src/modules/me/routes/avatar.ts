import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { okMessage } from "@/lib/responses";
import { OkMessage, okRes, withErrors } from "@/lib/schemas";
import { deleteUserAvatar, uploadUserAvatar } from "../services/avatar";

const AvatarResponse = t.Object({
	image: t.String({ description: "URL pubblica della nuova immagine profilo" }),
});

export const avatarRoutes = new Elysia()
	.post(
		"/avatar",
		async (ctx) => {
			const { user, body, store } = ctx as typeof ctx & {
				user: { id: string };
			};
			const pino = getLogger(store);
			const result = await uploadUserAvatar({
				userId: user.id,
				file: body.file,
			});
			pino.info(
				{ userId: user.id, action: "user_avatar_uploaded", key: result.key },
				"Immagine profilo aggiornata",
			);
			return { success: true as const, data: { image: result.url } };
		},
		{
			auth: true,
			body: t.Object({
				file: t.File({
					type: "image",
					maxSize: "5m",
					description: "Immagine (max 5MB, formati image/*)",
				}),
			}),
			response: withErrors({ 200: okRes(AvatarResponse) }),
			detail: {
				summary: "Carica immagine profilo",
				description:
					"Carica un'immagine per l'utente corrente. Il file viene ridimensionato a 512x512 JPEG e salvato su S3. La URL viene scritta su `user.image`.",
				tags: ["Me"],
				security: [{ bearerAuth: [] }],
			},
		},
	)
	.delete(
		"/avatar",
		async (ctx) => {
			const { user, store } = ctx as typeof ctx & { user: { id: string } };
			const pino = getLogger(store);
			await deleteUserAvatar({ userId: user.id });
			pino.info(
				{ userId: user.id, action: "user_avatar_deleted" },
				"Immagine profilo rimossa",
			);
			return okMessage("Avatar removed");
		},
		{
			auth: true,
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Rimuovi immagine profilo",
				description:
					"Setta `user.image` a NULL e cancella il file da S3 (best-effort). No-op se l'utente non ha un'immagine.",
				tags: ["Me"],
				security: [{ bearerAuth: [] }],
			},
		},
	);
