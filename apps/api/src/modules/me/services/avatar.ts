import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { user as userTable } from "@/db/schemas/auth";
import { env } from "@/lib/env";
import { ServiceError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { publicUrl, s3 } from "@/lib/s3";

interface UploadUserAvatarParams {
	userId: string;
	file: File;
}

/**
 * Restituisce la S3 key se la URL appartiene al nostro bucket (prefisso `users/`),
 * altrimenti null (es. URL legacy o da provider esterno OAuth).
 */
function extractOurKey(imageUrl: string): string | null {
	const expectedPrefix = `${env.S3_ENDPOINT}/${env.S3_BUCKET}/`;
	if (!imageUrl.startsWith(expectedPrefix)) return null;
	const key = imageUrl.slice(expectedPrefix.length);
	return key.startsWith("users/") ? key : null;
}

export async function uploadUserAvatar({
	userId,
	file,
}: UploadUserAvatarParams) {
	const current = await db.query.user.findFirst({
		where: eq(userTable.id, userId),
		columns: { image: true },
	});

	const buffer = Buffer.from(await file.arrayBuffer());
	let processed: Buffer;
	try {
		processed = await sharp(buffer)
			.resize(512, 512, { fit: "cover", position: "centre" })
			.jpeg({ quality: 85 })
			.toBuffer();
	} catch {
		throw new ServiceError(400, "Immagine non valida o corrotta");
	}

	const key = `users/${userId}/${crypto.randomUUID()}.jpg`;
	const url = publicUrl(key);
	await s3.write(key, processed);

	try {
		await db
			.update(userTable)
			.set({ image: url })
			.where(eq(userTable.id, userId));
	} catch (err) {
		await s3.delete(key).catch(() => {
			// rollback best-effort
		});
		throw err;
	}

	if (current?.image) {
		const oldKey = extractOurKey(current.image);
		if (oldKey) {
			s3.delete(oldKey).catch((err) => {
				logger.warn(
					{
						userId,
						oldKey,
						action: "avatar_old_cleanup_failed",
						err: String(err),
					},
					"Cleanup vecchia immagine profilo fallito",
				);
			});
		}
	}

	return { key, url };
}

interface DeleteUserAvatarParams {
	userId: string;
}

export async function deleteUserAvatar({ userId }: DeleteUserAvatarParams) {
	const current = await db.query.user.findFirst({
		where: eq(userTable.id, userId),
		columns: { image: true },
	});
	if (!current?.image) return; // no-op

	await db
		.update(userTable)
		.set({ image: null })
		.where(eq(userTable.id, userId));

	const oldKey = extractOurKey(current.image);
	if (oldKey) {
		await s3.delete(oldKey).catch((err) => {
			logger.warn(
				{
					userId,
					oldKey,
					action: "avatar_old_cleanup_failed",
					err: String(err),
				},
				"Cleanup immagine profilo fallito durante DELETE",
			);
		});
	}
}
