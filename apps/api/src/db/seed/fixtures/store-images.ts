import { isNull } from "drizzle-orm";
import { db } from "@/db";
import { store } from "@/db/schemas/store";
import { storeImage } from "@/db/schemas/store-image";

const CHUNK = 500;

function chunked<T>(arr: T[], size = CHUNK): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		out.push(arr.slice(i, i + size));
	}
	return out;
}

/** First 8 hex chars of a UUID parsed as int — deterministic per store. */
function hashHex(id: string): number {
	return Number.parseInt(id.replaceAll("-", "").slice(0, 8), 16);
}

/**
 * Placeholder cover images for stores. Same approach as productImage: picsum
 * URLs in DB, MinIO not touched (extractOurKey filters non-ours on cleanup).
 * Idempotent: only stores currently without any image get rows.
 */
export async function seedStoreImages() {
	const stores = await db
		.select({ id: store.id })
		.from(store)
		.where(isNull(store.deletedAt));

	const withImages = await db
		.selectDistinct({ storeId: storeImage.storeId })
		.from(storeImage);
	const withImagesSet = new Set(withImages.map((r) => r.storeId));

	const targets = stores.filter((s) => !withImagesSet.has(s.id));

	if (targets.length === 0) {
		console.log("  ⏭ Store images already seeded, skipping");
		return;
	}

	const imageRows: Array<typeof storeImage.$inferInsert> = [];
	for (const s of targets) {
		imageRows.push({
			storeId: s.id,
			url: `https://picsum.photos/seed/store-${s.id}/1200/600`,
			key: `picsum-store-${s.id}-0`,
			position: 0,
		});
		// ~30% also get a second cover (deterministic from store.id)
		if (hashHex(s.id) % 10 < 3) {
			imageRows.push({
				storeId: s.id,
				url: `https://picsum.photos/seed/store-${s.id}-2/1200/600`,
				key: `picsum-store-${s.id}-1`,
				position: 1,
			});
		}
	}

	for (const chunk of chunked(imageRows)) {
		await db.insert(storeImage).values(chunk);
	}

	console.log(
		`  ✓ ${imageRows.length} store images seeded (${targets.length} stores)`,
	);
}
