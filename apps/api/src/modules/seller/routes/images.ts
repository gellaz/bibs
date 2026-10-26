import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import { ProductImageSchema } from "@/lib/zod/entities";
import { OkMessage, okRes, withErrors } from "@/lib/zod/responses";
import { zFiles, zInteger } from "@/lib/zod/t";
import { deleteProductImage, uploadProductImages } from "../services/images";

const productId = z.string().meta({ description: "ID del prodotto" });

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

const ImagesRes = okRes(z.array(ProductImageSchema));

export const imagesRoutes = new Hono()
	.post(
		"/products/:productId/images",
		doc({
			response: withErrors({ 200: ImagesRes }),
			detail: {
				summary: "Upload immagini prodotto",
				description:
					"Carica una o più immagini per un prodotto. Le immagini vengono salvate su S3.",
				tags: ["Seller - Product Images"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("param", z.object({ productId })),
		v("form", ImagesBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			const user = c.var.user;
			const params = c.req.valid("param");
			const body = c.req.valid("form");
			const data = await uploadProductImages({
				productId: params.productId,
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
					productId: params.productId,
					imageCount: data.length,
					action: "product_images_uploaded",
				},
				`${data.length} immagini prodotto caricate`,
			);

			return send(c, ImagesRes, ok(data));
		},
	)
	.delete(
		"/products/:productId/images/:imageId",
		doc({
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina immagine prodotto",
				description: "Elimina un'immagine dal prodotto e dal bucket S3.",
				tags: ["Seller - Product Images"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v(
			"param",
			z.object({
				productId,
				imageId: z.string().meta({ description: "ID dell'immagine" }),
			}),
		),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp, isOwner } = c.var.seller;
			const params = c.req.valid("param");
			await deleteProductImage({
				productId: params.productId,
				sellerProfileId: sp.id,
				userId: c.var.user.id,
				isOwner,
				imageId: params.imageId,
			});
			return send(c, OkMessage, okMessage("Immagine eliminata"));
		},
	);
