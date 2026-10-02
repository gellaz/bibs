import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { product } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { publicUrl, s3 } from "@/lib/s3";
import { ensureProductAccess } from "../context";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function countImages(productId: string, executor: typeof db | Tx = db) {
	const [{ current }] = await executor
		.select({ current: count() })
		.from(productImage)
		.where(eq(productImage.productId, productId));
	return current;
}

function tooMany(current: number, uploading: number) {
	return new ServiceError(
		400,
		`Massimo ${config.maxImagesPerProduct} immagini per prodotto (attuali: ${current}, in caricamento: ${uploading})`,
	);
}

interface UploadProductImagesParams {
	productId: string;
	sellerProfileId: string;
	userId: string;
	isOwner: boolean;
	files: File[];
	position?: number;
}

export async function uploadProductImages(params: UploadProductImagesParams) {
	const { productId, sellerProfileId, userId, isOwner, files, position } =
		params;
	await ensureProductAccess(productId, { userId, sellerProfileId, isOwner });

	// Pre-check before touching S3; the authoritative check runs again under a
	// lock in the insert transaction.
	const current = await countImages(productId);
	if (current + files.length > config.maxImagesPerProduct)
		throw tooMany(current, files.length);

	// 1. Upload all files to S3 first
	const uploaded: { key: string; url: string; index: number }[] = [];
	try {
		await Promise.all(
			files.map(async (file, index) => {
				const ext = file.name?.split(".").pop() ?? "jpg";
				const key = `products/${productId}/${crypto.randomUUID()}.${ext}`;
				await s3.write(key, file);
				uploaded.push({ key, url: publicUrl(key), index });
			}),
		);
	} catch (err) {
		// Cleanup any files that were already uploaded
		await Promise.allSettled(uploaded.map((u) => s3.delete(u.key)));
		throw err;
	}

	// 2. Count and insert under a lock on the product: two concurrent uploads
	// both passing the pre-check would otherwise overshoot the cap.
	try {
		return await db.transaction(async (tx) => {
			await tx
				.select({ id: product.id })
				.from(product)
				.where(eq(product.id, productId))
				.for("update");
			const locked = await countImages(productId, tx);
			if (locked + files.length > config.maxImagesPerProduct)
				throw tooMany(locked, files.length);

			return tx
				.insert(productImage)
				.values(
					uploaded.map(({ key, url, index }) => ({
						productId,
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

interface DeleteProductImageParams {
	productId: string;
	sellerProfileId: string;
	userId: string;
	isOwner: boolean;
	imageId: string;
}

export async function deleteProductImage(params: DeleteProductImageParams) {
	const { productId, sellerProfileId, userId, isOwner, imageId } = params;
	await ensureProductAccess(productId, { userId, sellerProfileId, isOwner });

	const img = await db.query.productImage.findFirst({
		where: and(
			eq(productImage.id, imageId),
			eq(productImage.productId, productId),
		),
	});
	if (!img) throw new ServiceError(404, "Immagine non trovata");

	await s3.delete(img.key);
	await db.delete(productImage).where(eq(productImage.id, imageId));

	return img;
}
