import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { storeImage } from "@/db/schemas/store-image";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { publicUrl, s3 } from "@/lib/s3";
import { ensureStoreAccess } from "../context";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function countImages(storeId: string, executor: typeof db | Tx = db) {
	const [{ current }] = await executor
		.select({ current: count() })
		.from(storeImage)
		.where(eq(storeImage.storeId, storeId));
	return current;
}

function tooMany(current: number, uploading: number) {
	return new ServiceError(
		400,
		`Maximum ${config.maxImagesPerStore} images per store (current: ${current}, uploading: ${uploading})`,
	);
}

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

	// Pre-check before touching S3; the authoritative check runs again under a
	// lock in the insert transaction.
	const current = await countImages(storeId);
	if (current + files.length > config.maxImagesPerStore)
		throw tooMany(current, files.length);

	// 1. Upload all files to S3 first
	const uploaded: { key: string; url: string; index: number }[] = [];
	try {
		await Promise.all(
			files.map(async (file, index) => {
				const ext = file.name?.split(".").pop() ?? "jpg";
				const key = `stores/${storeId}/${crypto.randomUUID()}.${ext}`;
				await s3.write(key, file);
				uploaded.push({ key, url: publicUrl(key), index });
			}),
		);
	} catch (err) {
		// Cleanup any files that were already uploaded
		await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
		throw err;
	}

	// 2. Count and insert under a lock on the store: two concurrent uploads
	// both passing the pre-check would otherwise overshoot the cap.
	try {
		return await db.transaction(async (tx) => {
			await tx
				.select({ id: store.id })
				.from(store)
				.where(eq(store.id, storeId))
				.for("update");
			const locked = await countImages(storeId, tx);
			if (locked + files.length > config.maxImagesPerStore)
				throw tooMany(locked, files.length);

			return tx
				.insert(storeImage)
				.values(
					uploaded.map(({ key, url, index }) => ({
						storeId,
						key,
						url,
						position: position ?? locked + index,
					})),
				)
				.returning();
		});
	} catch (err) {
		// Cap exceeded or insert failed — cleanup S3 files (best-effort)
		await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
		throw err;
	}
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
	if (!img) throw new ServiceError(404, "Image not found");

	await s3.delete(img.key);
	await db.delete(storeImage).where(eq(storeImage.id, imageId));

	return img;
}
