import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { product } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { s3 } from "@/infra/s3";
import { config } from "@/lib/config";
import { ServiceError } from "@/lib/errors";
import { ensureProductAccess } from "../context";
import { uploadImages } from "./image-upload";

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

	return uploadImages(
		{
			folder: `products/${productId}`,
			max: config.maxImagesPerProduct,
			noun: "prodotto",
			count: (executor) =>
				executor.$count(productImage, eq(productImage.productId, productId)),
			lock: (tx) =>
				tx
					.select({ id: product.id })
					.from(product)
					.where(eq(product.id, productId))
					.for("update"),
			insert: (tx, rows) =>
				tx
					.insert(productImage)
					.values(rows.map((row) => ({ productId, ...row })))
					.returning(),
		},
		files,
		position,
	);
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
