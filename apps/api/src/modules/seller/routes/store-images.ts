import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okMessage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import { StoreImageSchema } from "@/schemas/entities";
import { OkMessage, okRes, withErrors } from "@/schemas/responses";
import { zFiles, zInteger } from "@/schemas/t";
import { deleteStoreImage, uploadStoreImages } from "../services/store-images";

const storeId = z.string().meta({ description: "ID del negozio" });

const ImagesBody = z.object({
	files: zFiles({
		type: "image",
		maxSize: "5m",
		description: "Immagini (max 5MB ciascuna, solo formati immagine)",
	}),
	position: zInteger({
		minimum: 0,
		description: "Posizione di ordinamento (default: indice del file)",
	}).optional(),
});

const ImagesRes = okRes(z.array(StoreImageSchema));

export const storeImagesRoutes = new Hono()
	.post(
		"/stores/:storeId/images",
		doc({
			response: withErrors({ 200: ImagesRes }),
			detail: {
				summary: "Upload immagini negozio",
				description:
					"Carica una o più immagini per un negozio. Le immagini vengono salvate su S3.",
				tags: ["Seller - Store Images"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("param", z.object({ storeId })),
		v("form", ImagesBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			const user = c.var.user;
			const params = c.req.valid("param");
			const body = c.req.valid("form");
			const data = await uploadStoreImages({
				storeId: params.storeId,
				sellerProfileId: sp.id,
				userId: user.id,
				isOwner,
				files: body.files,
				position: body.position,
			});

			logger.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					storeId: params.storeId,
					imageCount: data.length,
					action: "store_images_uploaded",
				},
				`${data.length} immagini negozio caricate`,
			);

			return send(c, ImagesRes, ok(data));
		},
	)
	.delete(
		"/stores/:storeId/images/:imageId",
		doc({
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina immagine negozio",
				description: "Elimina un'immagine dal negozio e dal bucket S3.",
				tags: ["Seller - Store Images"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v(
			"param",
			z.object({
				storeId,
				imageId: z.string().meta({ description: "ID dell'immagine" }),
			}),
		),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			const params = c.req.valid("param");
			await deleteStoreImage({
				storeId: params.storeId,
				sellerProfileId: sp.id,
				userId: c.var.user.id,
				isOwner,
				imageId: params.imageId,
			});
			return send(c, OkMessage, okMessage("Immagine eliminata"));
		},
	);
