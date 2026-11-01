import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { storeImage } from "@/db/schemas/store-image";
import { s3 } from "@/infra/s3";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { ensureStoreAccess } from "../context";
import { uploadImages } from "./image-upload";

interface UploadStoreImagesParams {
	storeId: string;
	sellerProfileId: string;
	userId: string;
	isOwner: boolean;
	files: File[];
	position?: number;
}

export async function uploadStoreImages(params: UploadStoreImagesParams) {
	const { storeId, sellerProfileId, userId, isOwner, files, position } = params;
	await ensureStoreAccess(storeId, { userId, sellerProfileId, isOwner });

	return uploadImages(
		{
			folder: `stores/${storeId}`,
			max: config.maxImagesPerStore,
			noun: "negozio",
			count: (executor) =>
				executor.$count(storeImage, eq(storeImage.storeId, storeId)),
			lock: (tx) =>
				tx
					.select({ id: store.id })
					.from(store)
					.where(eq(store.id, storeId))
					.for("update"),
			insert: (tx, rows) =>
				tx
					.insert(storeImage)
					.values(rows.map((row) => ({ storeId, ...row })))
					.returning(),
		},
		files,
		position,
	);
}

interface DeleteStoreImageParams {
	storeId: string;
	sellerProfileId: string;
	userId: string;
	isOwner: boolean;
	imageId: string;
}

export async function deleteStoreImage(params: DeleteStoreImageParams) {
	const { storeId, sellerProfileId, userId, isOwner, imageId } = params;
	await ensureStoreAccess(storeId, { userId, sellerProfileId, isOwner });

	const img = await db.query.storeImage.findFirst({
		where: and(eq(storeImage.id, imageId), eq(storeImage.storeId, storeId)),
	});
	if (!img) throw new ServiceError(404, "Immagine non trovata");

	await s3.delete(img.key);
	await db.delete(storeImage).where(eq(storeImage.id, imageId));

	return img;
}
