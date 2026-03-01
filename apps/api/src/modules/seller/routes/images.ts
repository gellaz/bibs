import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import {
	OkMessage,
	okRes,
	ProductImageSchema,
	withErrors,
} from "@/lib/schemas";
import { withSeller } from "../context";
import { deleteProductImage, uploadProductImages } from "../services/images";

export const imagesRoutes = new Elysia()
	.post(
		"/products/:productId/images",
		async (ctx) => {
			const { sellerProfile: sp, params, body, user, store } = withSeller(ctx);
			const pino = getLogger(store);

			const files = Array.isArray(body.files) ? body.files : [body.files];
			const data = await uploadProductImages({
				productId: params.productId,
				sellerProfileId: sp.id,
				files,
				position: body.position,
			});

			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					productId: params.productId,
					imageCount: data.length,
					action: "product_images_uploaded",
				},
				`${data.length} immagini prodotto caricate`,
			);

			return ok(data);
		},
		{
			params: t.Object({
				productId: t.String({ description: "ID del prodotto" }),
			}),
			body: t.Object({
				files: t.Files({
					type: "image",
					maxSize: "5m",
					description: "Immagini (max 5MB ciascuna, solo formati immagine)",
				}),
				position: t.Optional(
					t.Number({
						minimum: 0,
						description: "Posizione di ordinamento (default: indice del file)",
					}),
				),
			}),
			response: withErrors({ 200: okRes(t.Array(ProductImageSchema)) }),
			detail: {
				summary: "Upload immagini prodotto",
				description:
					"Carica una o più immagini per un prodotto. Le immagini vengono salvate su S3/MinIO.",
				tags: ["Seller - Product Images"],
			},
		},
	)
	.delete(
		"/products/:productId/images/:imageId",
		async (ctx) => {
			const { sellerProfile: sp, params } = withSeller(ctx);
			await deleteProductImage({
				productId: params.productId,
				sellerProfileId: sp.id,
				imageId: params.imageId,
			});
			return okMessage("Image deleted");
		},
		{
			params: t.Object({
				productId: t.String({ description: "ID del prodotto" }),
				imageId: t.String({ description: "ID dell'immagine" }),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina immagine prodotto",
				description: "Elimina un'immagine dal prodotto e dal bucket S3/MinIO.",
				tags: ["Seller - Product Images"],
			},
		},
	);
