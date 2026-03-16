import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { storeImage } from "@/db/schemas/store-image";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { publicUrl, s3 } from "@/lib/s3";
import { ensureStoreOwnership } from "../context";

interface UploadStoreImagesParams {
	storeId: string;
	sellerProfileId: string;
	files: File[];
	position?: number;
}

export async function uploadStoreImages(params: UploadStoreImagesParams) {
	const { storeId, sellerProfileId, files, position } = params;
	await ensureStoreOwnership(storeId, sellerProfileId);

	// Enforce max images per store
	const [{ current }] = await db
		.select({ current: count() })
		.from(storeImage)
		.where(eq(storeImage.storeId, storeId));

	if (current + files.length > config.maxImagesPerStore) {
		throw new ServiceError(
			400,
			`Maximum ${config.maxImagesPerStore} images per store (current: ${current}, uploading: ${files.length})`,
		);
	}

	// 1. Upload all files to S3 first
	const uploaded: { key: string; url: string; position: number }[] = [];
	try {
		await Promise.all(
			files.map(async (file, i) => {
				const ext = file.name?.split(".").pop() ?? "jpg";
				const key = `stores/${storeId}/${crypto.randomUUID()}.${ext}`;
				await s3.write(key, file);
				uploaded.push({
					key,
					url: publicUrl(key),
					position: position ?? current + i,
				});
			}),
		);
	} catch (err) {
		// Cleanup any files that were already uploaded
		await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
		throw err;
	}

	// 2. Batch insert all DB records
	try {
		return await db
			.insert(storeImage)
			.values(uploaded.map((u) => ({ storeId, ...u })))
			.returning();
	} catch (err) {
		// DB insert failed — cleanup S3 files (best-effort)
		await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
		throw err;
	}
}

interface DeleteStoreImageParams {
	storeId: string;
	sellerProfileId: string;
	imageId: string;
}

export async function deleteStoreImage(params: DeleteStoreImageParams) {
	const { storeId, sellerProfileId, imageId } = params;
	await ensureStoreOwnership(storeId, sellerProfileId);

	const img = await db.query.storeImage.findFirst({
		where: and(eq(storeImage.id, imageId), eq(storeImage.storeId, storeId)),
	});
	if (!img) throw new ServiceError(404, "Image not found");

	await s3.delete(img.key);
	await db.delete(storeImage).where(eq(storeImage.id, imageId));

	return img;
}
