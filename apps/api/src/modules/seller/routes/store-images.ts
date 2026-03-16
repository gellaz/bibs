import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { ok, okMessage } from "@/lib/responses";
import { OkMessage, okRes, StoreImageSchema, withErrors } from "@/lib/schemas";
import { withSeller } from "../context";
import { deleteStoreImage, uploadStoreImages } from "../services/store-images";

export const storeImagesRoutes = new Elysia()
	.post(
		"/stores/:storeId/images",
		async (ctx) => {
			const { sellerProfile: sp, params, body, user, store } = withSeller(ctx);
			const pino = getLogger(store);

			const files = Array.isArray(body.files) ? body.files : [body.files];
			const data = await uploadStoreImages({
				storeId: params.storeId,
				sellerProfileId: sp.id,
				files,
				position: body.position,
			});

			pino.info(
				{
					userId: user.id,
					sellerProfileId: sp.id,
					storeId: params.storeId,
					imageCount: data.length,
					action: "store_images_uploaded",
				},
				`${data.length} immagini negozio caricate`,
			);

			return ok(data);
		},
		{
			params: t.Object({
				storeId: t.String({ description: "ID del negozio" }),
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
			response: withErrors({ 200: okRes(t.Array(StoreImageSchema)) }),
			detail: {
				summary: "Upload immagini negozio",
				description:
					"Carica una o più immagini per un negozio. Le immagini vengono salvate su S3/MinIO.",
				tags: ["Seller - Store Images"],
			},
		},
	)
	.delete(
		"/stores/:storeId/images/:imageId",
		async (ctx) => {
			const { sellerProfile: sp, params } = withSeller(ctx);
			await deleteStoreImage({
				storeId: params.storeId,
				sellerProfileId: sp.id,
				imageId: params.imageId,
			});
			return okMessage("Image deleted");
		},
		{
			params: t.Object({
				storeId: t.String({ description: "ID del negozio" }),
				imageId: t.String({ description: "ID dell'immagine" }),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina immagine negozio",
				description: "Elimina un'immagine dal negozio e dal bucket S3/MinIO.",
				tags: ["Seller - Store Images"],
			},
		},
	);
