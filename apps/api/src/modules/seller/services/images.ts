import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { productImage } from "@/db/schemas/product-image";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { publicUrl, s3 } from "@/lib/s3";
import { ensureProductOwnership } from "../context";

interface UploadProductImagesParams {
	productId: string;
	sellerProfileId: string;
	files: File[];
	position?: number;
}

export async function uploadProductImages(params: UploadProductImagesParams) {
	const { productId, sellerProfileId, files, position } = params;
	await ensureProductOwnership(productId, sellerProfileId);

	// Enforce max images per product
	const [{ current }] = await db
		.select({ current: count() })
		.from(productImage)
		.where(eq(productImage.productId, productId));

	if (current + files.length > config.maxImagesPerProduct) {
		throw new ServiceError(
			400,
			`Maximum ${config.maxImagesPerProduct} images per product (current: ${current}, uploading: ${files.length})`,
		);
	}

	// 1. Upload all files to S3 first
	const uploaded: { key: string; url: string; position: number }[] = [];
	try {
		await Promise.all(
			files.map(async (file, i) => {
				const ext = file.name?.split(".").pop() ?? "jpg";
				const key = `products/${productId}/${crypto.randomUUID()}.${ext}`;
				await s3.write(key, file);
				uploaded.push({ key, url: publicUrl(key), position: position ?? i });
			}),
		);
	} catch (err) {
		// Cleanup any files that were already uploaded
		await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
		throw err;
	}

	// 2. Batch insert all DB records in a single transaction
	try {
		return await db
			.insert(productImage)
			.values(uploaded.map((u) => ({ productId, ...u })))
			.returning();
	} catch (err) {
		// DB insert failed — cleanup S3 files (best-effort)
		await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
		throw err;
	}
}

interface DeleteProductImageParams {
	productId: string;
	sellerProfileId: string;
	imageId: string;
}

export async function deleteProductImage(params: DeleteProductImageParams) {
	const { productId, sellerProfileId, imageId } = params;
	await ensureProductOwnership(productId, sellerProfileId);

	const img = await db.query.productImage.findFirst({
		where: and(
			eq(productImage.id, imageId),
			eq(productImage.productId, productId),
		),
	});
	if (!img) throw new ServiceError(404, "Image not found");

	await s3.delete(img.key);
	await db.delete(productImage).where(eq(productImage.id, imageId));

	return img;
}
